import { getBalance, appendEntry } from "./ledger.service";
import {
  usageToInternalTokens,
  MIN_BALANCE_FOR_GENERATION,
  DEPLOYMENT_FEE_TOKENS,
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

export class InsufficientBalanceForDeploymentError extends Error {
  constructor(public readonly balance: number, public readonly minimumRequired: number) {
    super(`Balance ${balance} is below the ${minimumRequired}-token deployment fee`);
    this.name = "InsufficientBalanceForDeploymentError";
  }
}

/**
 * Pre-flight check, run before a deploy touches Vercel or the database.
 * Unlike generation, a deploy's cost is a known fixed fee up front — not a
 * ceiling on unpredictable usage — so this is an exact check, not a
 * conservative one.
 */
export async function assertSufficientBalanceForDeployment(userId: string): Promise<number> {
  const balance = await getBalance(userId);
  if (balance < DEPLOYMENT_FEE_TOKENS) {
    throw new InsufficientBalanceForDeploymentError(balance, DEPLOYMENT_FEE_TOKENS);
  }
  return balance;
}

/**
 * Debits the fixed deployment fee, linking the entry to this deployment.
 * Only ever called after Vercel has confirmed the deployment is live —
 * never charge for a deploy that didn't happen.
 */
export async function chargeForDeployment(userId: string, deploymentId: string): Promise<number> {
  await appendEntry({
    userId,
    type: "DEBIT_DEPLOYMENT",
    amount: -DEPLOYMENT_FEE_TOKENS,
    deploymentId,
  });
  return DEPLOYMENT_FEE_TOKENS;
}
