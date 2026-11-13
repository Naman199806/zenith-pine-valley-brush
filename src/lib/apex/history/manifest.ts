import { createHash } from "node:crypto";

export function sha256Hex(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

export function verifyChecksum(content: string, expected: string): boolean {
  return sha256Hex(content) === expected.toLowerCase();
}
