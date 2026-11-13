/** Integer cents for cash. Prices and quantities use integer micros (1e-6). */

export function mulDiv(a: number, b: number, div: number): number {
  if (!Number.isSafeInteger(a) || !Number.isSafeInteger(b) || !Number.isSafeInteger(div) || div === 0) {
    throw new Error("mulDiv requires safe integers");
  }
  const n = BigInt(a) * BigInt(b);
  const d = BigInt(div);
  const neg = n < 0n;
  const abs = neg ? -n : n;
  const q = abs / d;
  const r = abs % d;
  const rounded = r * 2n >= d ? q + 1n : q;
  return Number(neg ? -rounded : rounded);
}

/** Cash cents from a price in micros and a quantity in micros. */
export function notionalCents(priceMicros: number, qtyMicros: number): number {
  return mulDiv(priceMicros, qtyMicros, 10_000_000_000);
}

export function fmtCents(cents: number): string {
  if (!Number.isFinite(cents)) return "—";
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(Math.trunc(cents));
  const dollars = Math.floor(abs / 100);
  const rem = abs % 100;
  return `${sign}$${dollars.toLocaleString("en-US")}.${rem.toString().padStart(2, "0")}`;
}

export function fmtMicros(micros: number, digits = 2): string {
  if (!Number.isFinite(micros)) return "—";
  const sign = micros < 0 ? "-" : "";
  const abs = Math.abs(Math.trunc(micros));
  const whole = Math.floor(abs / 1_000_000);
  const frac = Math.floor((abs % 1_000_000) / 10 ** (6 - digits));
  return `${sign}${whole.toLocaleString("en-US")}.${frac.toString().padStart(digits, "0")}`;
}

export function fmtPct(x: number): string {
  if (!Number.isFinite(x)) return "undefined";
  const pct = x * 100;
  const sign = pct > 0 ? "+" : "";
  return `${sign}${pct.toFixed(2)}%`;
}

export function fmtNum(x: number, digits = 2): string {
  if (!Number.isFinite(x)) return "undefined";
  return x.toFixed(digits);
}

export function bpsOf(cents: number, bps: number): number {
  return mulDiv(Math.abs(cents), bps, 10_000);
}
