import type { LedgerEntryType } from "@prisma/client";
import { prisma, withRetry } from "../lib/prisma";

export class InsufficientBalanceError extends Error {
  constructor(required: number, available: number) {
    super(`Insufficient balance: need ${required}, have ${available}`);
    this.name = "InsufficientBalanceError";
  }
}

interface AppendEntryInput {
  userId: string;
  type: LedgerEntryType;
  amount: number; // positive for credit, negative for debit
  purchaseId?: string;
  generationId?: string;
  deploymentId?: string;
}

/**
 * The only function in the codebase allowed to write a LedgerEntry.
 * Reads the latest running balance, computes the new one, and inserts
 * the new row — all inside one transaction so concurrent requests
 * can't race past each other and produce a negative balance.
 */
export async function appendEntry(input: AppendEntryInput) {
  // The whole transaction is retried as one unit on a transient
  // connection error, not any single statement inside it — see
  // lib/prisma.ts for why that's the safe way to retry an atomic
  // operation like this one.
  return withRetry(() => prisma.$transaction(async (tx) => {
    // Serializes every ledger write for this user against every other one.
    // Without it the read-then-insert below is not actually atomic: Prisma
    // runs this transaction at Postgres's default READ COMMITTED, so two
    // concurrent debits both read the same latest entry, both compute the
    // same new balance, and both insert against it — spending the same
    // tokens twice and leaving the running-balance snapshot disagreeing
    // with the sum of entries. The unique generationId/deploymentId
    // constraints only stop the *same* generation being charged twice;
    // they say nothing about two different concurrent debits.
    //
    // A row lock rather than isolationLevel: "Serializable" because that
    // would surface as a serialization failure needing its own retry
    // classification in lib/prisma.ts, where withRetry currently matches
    // connection errors only.
    await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${input.userId} FOR UPDATE`;

    const latest = await tx.ledgerEntry.findFirst({
      where: { userId: input.userId },
      orderBy: { createdAt: "desc" },
    });

    const currentBalance = latest?.runningBalance ?? 0;
    const newBalance = currentBalance + input.amount;

    if (newBalance < 0) {
      throw new InsufficientBalanceError(-input.amount, currentBalance);
    }

    return tx.ledgerEntry.create({
      data: {
        userId: input.userId,
        type: input.type,
        amount: input.amount,
        runningBalance: newBalance,
        purchaseId: input.purchaseId,
        generationId: input.generationId,
        deploymentId: input.deploymentId,
      },
    });
  }));
}

/**
 * Fast path: balance is just the runningBalance of the most recent entry.
 */
export async function getBalance(userId: string): Promise<number> {
  const latest = await prisma.ledgerEntry.findFirst({
    where: { userId },
    orderBy: { createdAt: "desc" },
  });
  return latest?.runningBalance ?? 0;
}

/**
 * Slow path / reconciliation check: recompute balance by summing every
 * entry from scratch. Should always equal getBalance() — this is what
 * makes "balance reconstructable from ledger alone" actually true,
 * not just a claim in the README.
 */
export async function reconstructBalance(userId: string): Promise<number> {
  const result = await prisma.ledgerEntry.aggregate({
    where: { userId },
    _sum: { amount: true },
  });
  return result._sum.amount ?? 0;
}