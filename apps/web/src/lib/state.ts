import type { FileMap } from "./api";

export type GenerationState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "succeeded"; generationId: string; files: FileMap; tokensCharged: number }
  | { status: "insufficient_balance"; balance: number; minimumRequired: number }
  | { status: "failed"; httpStatus: number; error: string; reason?: string };

export type DeployState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "live"; url: string; tokensCharged: number }
  | { status: "insufficient_balance"; balance: number; minimumRequired: number }
  | { status: "failed"; httpStatus: number; error: string; message?: string };

export type View = "build" | "history" | "billing";
