export function parsePaperKeys(
  keyId: unknown,
  secret: unknown,
): { ok: true; keyId: string; secret: string } | { ok: false; reason: string } {
  if (typeof keyId !== "string" || typeof secret !== "string") {
    return { ok: false, reason: "Both the paper key ID and the paper secret are required." };
  }
  const id = keyId.trim();
  const sec = secret.trim();
  if (!id || !sec) return { ok: false, reason: "Both the paper key ID and the paper secret are required." };
  if (/\s/.test(id) || /\s/.test(sec)) return { ok: false, reason: "A key cannot contain spaces or line breaks." };
  if (id.startsWith("AK")) return { ok: false, reason: "That key looks like a live key. Paste the paper key instead." };
  if (id.length < 8 || id.length > 128 || sec.length < 8 || sec.length > 256) {
    return { ok: false, reason: "Those values do not look like an Alpaca paper key pair." };
  }
  return { ok: true, keyId: id, secret: sec };
}
