import { Router } from "express";
import { PrismaClient } from "@prisma/client";
import { deployToVercel } from "../services/deployment.service";
import {
  assertSufficientBalanceForDeployment,
  chargeForDeployment,
  InsufficientBalanceForDeploymentError,
} from "../services/billing.service";
import { InsufficientBalanceError } from "../services/ledger.service";
import type { FileMap } from "../services/llm.service";

const prisma = new PrismaClient();
const router = Router();

// No auth yet — hardcoded to the one seeded demo user.
const DEMO_USER_ID = process.env.DEMO_USER_ID!;

router.post("/deploy/:generationId", async (req, res) => {
  const { generationId } = req.params;

  const generation = await prisma.generation.findFirst({
    where: { id: generationId, userId: DEMO_USER_ID },
    include: { deployment: true },
  });

  if (!generation) {
    res.status(404).json({ error: "Generation not found" });
    return;
  }

  if (generation.status !== "SUCCEEDED" || !generation.generatedFiles) {
    res.status(400).json({ error: "Generation did not succeed; nothing to deploy" });
    return;
  }

  if (generation.deployment) {
    res.status(409).json({
      error: "Generation is already deployed",
      deploymentId: generation.deployment.id,
      status: generation.deployment.status,
      liveUrl: generation.deployment.liveUrl,
    });
    return;
  }

  try {
    await assertSufficientBalanceForDeployment(DEMO_USER_ID);
  } catch (err) {
    if (err instanceof InsufficientBalanceForDeploymentError) {
      res.status(402).json({
        error: "Insufficient balance",
        balance: err.balance,
        minimumRequired: err.minimumRequired,
      });
      return;
    }
    throw err;
  }

  const deployment = await prisma.deployment.create({
    data: {
      generationId: generation.id,
      userId: DEMO_USER_ID,
      status: "PENDING",
    },
  });

  // Deterministic per-generation project name — Vercel creates the
  // project on first use and reuses it if this route is ever called
  // again for the same generation before the `deployment` row exists
  // (e.g. a retry after a crash between create() and the Vercel call).
  const projectName = `mini-lovable-${generation.id}`.toLowerCase();
  const result = await deployToVercel(generation.generatedFiles as FileMap, projectName);

  if (result.status === "error") {
    // Vercel never confirmed the deploy, so no charge — same principle as
    // an invalid LLM generation: we don't bill for our own failure.
    await prisma.deployment.update({
      where: { id: deployment.id },
      data: { status: "FAILED" },
    });
    res.status(502).json({
      error: "Deployment failed",
      message: result.message,
      deploymentId: deployment.id,
    });
    return;
  }

  try {
    const tokensCharged = await chargeForDeployment(DEMO_USER_ID, deployment.id);
    await prisma.deployment.update({
      where: { id: deployment.id },
      data: { status: "LIVE", liveUrl: result.url, tokensCharged },
    });
    res.json({
      deploymentId: deployment.id,
      status: "LIVE",
      url: result.url,
      tokensCharged,
    });
  } catch (err) {
    if (err instanceof InsufficientBalanceError) {
      // The site is already live on Vercel at this point — a concurrent
      // request drained the balance between the pre-flight check and
      // here. Same rule as generation billing: never report success
      // without a debit backing it, so the business absorbs this sunk,
      // rare-race Vercel deploy rather than handing out a free one.
      await prisma.deployment.update({
        where: { id: deployment.id },
        data: { status: "FAILED" },
      });
      res.status(402).json({ error: "Insufficient balance to complete charge", deploymentId: deployment.id });
      return;
    }
    throw err;
  }
});

export default router;
