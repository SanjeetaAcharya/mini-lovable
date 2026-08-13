import { getBalance, appendEntry } from "./ledger.service";
import {
  usageToInternalTokens,
  MIN_BALANCE_FOR_GENERATION,
  LlmUsageForPricing,
} from "../config/pricing";

export class InsufficientBalanceForGenerationError extends Error {
  constructor(public readonly balance: number, public readonly minimumRequired: number) {
    super(
      `Balance ${balance} is below the ${minimumRequired}-token minimum required to start a generation`
    );
    this.name = "InsufficientBalanceForGenerationError";
  }
}

/**
 * Pre-flight check, run before the LLM is ever called. This is a
 * conservative floor, not the real charge — the real charge is only known
 * after generation, once real usage exists. Its only job is making sure we
 * never spend OpenRouter usage on a request we already know we can't
 * bill for.
 */
export async function assertSufficientBalance(userId: string): Promise<number> {
  const balance = await getBalance(userId);
  if (balance < MIN_BALANCE_FOR_GENERATION) {
    throw new InsufficientBalanceForGenerationError(balance, MIN_BALANCE_FOR_GENERATION);
  }
  return balance;
}

/**
 * Converts real usage into internal tokens and debits the ledger, linking
 * the entry to this generation. appendEntry() is the real, final balance
 * check — if actual usage prices out to more than the user's current
 * balance (e.g. a concurrent request from the same user slipped past the
 * pre-flight check), this throws InsufficientBalanceError and the caller
 * must not treat the generation as billed.
 */
export async function chargeForGeneration(
  userId: string,
  generationId: string,
  usage: LlmUsageForPricing
): Promise<number> {
  const tokensCharged = usageToInternalTokens(usage);
  await appendEntry({
    userId,
    type: "DEBIT_GENERATION",
    amount: -tokensCharged,
    generationId,
  });
  return tokensCharged;
}
