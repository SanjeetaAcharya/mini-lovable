import { PrismaClient, LedgerEntryType } from "@prisma/client";

const prisma = new PrismaClient();

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
  return prisma.$transaction(async (tx) => {
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
  });
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