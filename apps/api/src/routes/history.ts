import { Router } from "express";
import { prisma } from "../lib/prisma";
import { asyncHandler } from "../middleware/asyncHandler";

const router = Router();

// No auth yet — hardcoded to the one seeded demo user.
const DEMO_USER_ID = process.env.DEMO_USER_ID!;

// One combined shape the frontend can render as three lists — deliberately
// excludes `generatedFiles` (the frontend already has that from the
// /generate response for whichever generation it just made; re-sending
// every generation's full file map on every history load would be waste).
router.get(
  "/history",
  asyncHandler(async (_req, res) => {
    const [purchases, generations, deployments] = await Promise.all([
      prisma.purchase.findMany({
        where: { userId: DEMO_USER_ID },
        include: { invoice: true },
        orderBy: { createdAt: "desc" },
      }),
      prisma.generation.findMany({
        where: { userId: DEMO_USER_ID },
        orderBy: { createdAt: "desc" },
      }),
      prisma.deployment.findMany({
        where: { userId: DEMO_USER_ID },
        orderBy: { createdAt: "desc" },
      }),
    ]);

    res.json({
      purchases: purchases.map((p) => ({
        id: p.id,
        amountCents: p.amountCents,
        tokensPurchased: p.tokensPurchased,
        status: p.status,
        createdAt: p.createdAt,
        invoiceId: p.invoice?.id ?? null,
      })),
      generations: generations.map((g) => ({
        id: g.id,
        prompt: g.prompt,
        status: g.status,
        tokensCharged: g.tokensCharged,
        createdAt: g.createdAt,
      })),
      deployments: deployments.map((d) => ({
        id: d.id,
        generationId: d.generationId,
        status: d.status,
        liveUrl: d.liveUrl,
        tokensCharged: d.tokensCharged,
        createdAt: d.createdAt,
      })),
    });
  })
);

export default router;
