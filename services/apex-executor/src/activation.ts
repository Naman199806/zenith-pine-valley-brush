/**
 * Time-bounded PAPER activation. A dev flag cannot open it.
 * The window is operator-signed, at most 15 minutes, and PAPER-only.
 */

import { createHmac, timingSafeEqual } from "node:crypto";
import { expiryProblem, timestampProblem } from "./supervised-order.ts";

export const ACTIVATION_MAX_MS = 15 * 60 * 1000;

export interface PaperActivation {
  v: 1;
  kind: "PAPER_ACTIVATION";
  startsAt: string;
  expiresAt: string;
  operatorProof: string;
}

export function activationMaterial(window: Pick<PaperActivation, "startsAt" | "expiresAt">): string {
  return ["v=1", "PAPER_ACTIVATION", "paper-only", window.startsAt, window.expiresAt, "live=false", "strategyApproved=false"].join("|");
}

export function signActivation(window: Pick<PaperActivation, "startsAt" | "expiresAt">, secret: string): string {
  return createHmac("sha256", secret).update(activationMaterial(window)).digest("hex");
}

function same(proof: string, expected: string): boolean {
  const left = Buffer.from(proof);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

export function verifyActivation(window: PaperActivation, env: NodeJS.ProcessEnv, now: number): string | null {
  if (window.v !== 1 || window.kind !== "PAPER_ACTIVATION") return "unsupported activation";
  if (env.APEX_EXECUTOR_DEV_SUBMIT === "true" && env.PAPER_POST_ENABLED !== "true") return "dev flag cannot authorize submission";
  if (env.PAPER_POST_ENABLED !== "true") return "PAPER POST DISABLED";
  if (env.LIVE_POST_ENABLED === "true" || env.APEX_EXECUTOR_ENABLE_LIVE === "I_ENABLE_LIVE") return "LIVE POST DISABLED";
  if (timestampProblem(window.startsAt) || timestampProblem(window.expiresAt)) return "activation window is not a finite timestamp";
  const starts = Date.parse(window.startsAt);
  const ends = Date.parse(window.expiresAt);
  if (!(ends > starts)) return "activation window is empty";
  if (ends - starts > ACTIVATION_MAX_MS) return "activation window exceeds 15 minutes";
  if (!Number.isFinite(now) || now < starts) return "activation window has not started";
  const expired = expiryProblem(window.expiresAt, now);
  if (expired) return "activation window closed";
  const secret = env.APEX_OPERATOR_SECRET ?? null;
  if (!secret) return "operator secret missing; research cannot mint approval";
  if (!window.operatorProof || !same(window.operatorProof, signActivation(window, secret))) return "activation proof mismatch";
  return null;
}
