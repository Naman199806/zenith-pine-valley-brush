/** Test-only evidence root. Production leaves this null. */
let root: string | null = null;

export function setEvidenceRoot(next: string | null): void {
  root = next;
}

export function evidenceRoot(): string {
  return root ?? process.cwd();
}
