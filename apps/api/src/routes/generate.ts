import { Router } from "express";
import { prisma } from "../lib/prisma";
import { generateSite } from "../services/llm.service";
import {
  assertSufficientBalance,
  chargeForGeneration,
  InsufficientBalanceForGenerationError,
} from "../services/billing.service";
import { getBalance, InsufficientBalanceError } from "../services/ledger.service";
import { asyncHandler } from "../middleware/asyncHandler";

const router = Router();

// No auth yet — hardcoded to the one seeded demo user.
const DEMO_USER_ID = process.env.DEMO_USER_ID!;

const MAX_PROMPT_LENGTH = 2000;

// This endpoint only ever generates static web sites. Reject prompts that
// are clearly trying to redirect the model into a different task (prompt
// injection, or just an off-topic request) before spending a call on them.
// Not a security boundary — the system prompt and output validation in
// llm.service.ts are what actually constrain the model — just a cheap
// early filter for the obvious cases.
const OFF_TASK_PATTERNS: RegExp[] = [
  /ignore (all|any|the) (previous|prior|above) instructions/i,
  /disregard (all|any|the) (previous|prior|above)/i,
  /you are now/i,
  /new system prompt/i,
  /reveal your (instructions|system prompt|prompt)/i,
  /\b(malware|ransomware|keylogger|virus)\b/i,
  /write (me )?(a|an) (poem|essay|story|song|screenplay)\b/i,
];

type PromptValidation = { ok: true; prompt: string } | { ok: false; error: string };

function validatePrompt(input: unknown): PromptValidation {
  if (typeof input !== "string" || input.trim().length === 0) {
    return { ok: false, error: "prompt is required" };
  }

  const prompt = input.trim();
  if (prompt.length > MAX_PROMPT_LENGTH) {
    return { ok: false, error: `prompt exceeds ${MAX_PROMPT_LENGTH} characters` };
  }
  if (OFF_TASK_PATTERNS.some((pattern) => pattern.test(prompt))) {
    return { ok: false, error: "prompt does not look like a website request" };
  }

  return { ok: true, prompt };
}

router.post(
  "/generate",
  asyncHandler(async (req, res) => {
  const validated = validatePrompt(req.body?.prompt);
  if (!validated.ok) {
    res.status(400).json({ error: validated.error });
    return;
  }
  const { prompt } = validated;

  try {
    await assertSufficientBalance(DEMO_USER_ID);
  } catch (err) {
    if (err instanceof InsufficientBalanceForGenerationError) {
      res.status(402).json({
        error: "Insufficient balance",
        balance: err.balance,
        minimumRequired: err.minimumRequired,
      });
      return;
    }
    throw err;
  }

  const generation = await prisma.generation.create({
    data: {
      userId: DEMO_USER_ID,
      prompt,
      status: "PENDING",
      llmModel: process.env.OPENROUTER_MODEL ?? "unknown",
    },
  });

  const result = await generateSite(prompt, generation.id);

  if (result.status === "success") {
    try {
      const tokensCharged = await chargeForGeneration(DEMO_USER_ID, generation.id, result.usage);
      await prisma.generation.update({
        where: { id: generation.id },
        data: {
          status: "SUCCEEDED",
          promptTokens: result.usage.promptTokens,
          completionTokens: result.usage.completionTokens,
          openrouterCostUsd: result.usage.costUsd,
          tokensCharged,
          generatedFiles: result.files,
        },
      });
      const balance = await getBalance(DEMO_USER_ID);
      res.json({
        generationId: generation.id,
        status: "SUCCEEDED",
        files: result.files,
        tokensCharged,
        balance,
      });
    } catch (err) {
      if (err instanceof InsufficientBalanceError) {
        // Real usage priced out to more than the pre-flight check allowed
        // for — a concurrent request from the same user, most likely.
        // The LLM call already happened and we absorb that cost, but we
        // cannot hand over files we can't charge for.
        await prisma.generation.update({
          where: { id: generation.id },
          data: {
            status: "FAILED",
            promptTokens: result.usage.promptTokens,
            completionTokens: result.usage.completionTokens,
            openrouterCostUsd: result.usage.costUsd,
          },
        });
        res.status(402).json({ error: "Insufficient balance to complete charge" });
        return;
      }
      throw err;
    }
    return;
  }

  if (result.status === "invalid_output") {
    // The model responded, but not usably. The user asked for a working
    // site and didn't get one, so we absorb the (real) usage cost rather
    // than charge for our own failure — no ledger debit here.
    await prisma.generation.update({
      where: { id: generation.id },
      data: {
        status: "FAILED",
        promptTokens: result.usage.promptTokens,
        completionTokens: result.usage.completionTokens,
        openrouterCostUsd: result.usage.costUsd,
      },
    });
    res.status(502).json({
      error: "Model returned output we couldn't use",
      reason: result.reason,
      generationId: generation.id,
    });
    return;
  }

  // result.status === "error" — the request to OpenRouter never completed,
  // so there's no usage to record and nothing to charge.
  await prisma.generation.update({
    where: { id: generation.id },
    data: { status: "FAILED" },
  });
  res.status(502).json({
    error: "Generation failed",
    message: result.message,
    generationId: generation.id,
  });
  })
);

export default router;
