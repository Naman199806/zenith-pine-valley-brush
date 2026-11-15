export interface FeedObservation {
  source: string;
  title: string;
  published: string | null;
  url: string | null;
}

function clean(value: string | null): string | null {
  if (!value) return null;
  return value.replace(/<!\[CDATA\[|\]\]>/g, "").trim() || null;
}

export function parseRssDate(value: string | null): string | null {
  const cleaned = clean(value);
  if (!cleaned) return null;
  const ms = Date.parse(cleaned);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

export function parseRss(xml: string, limit = 5): FeedObservation[] {
  const items = xml.split("<item>").slice(1, limit + 1);
  return items.map((item) => ({
    source: "rss",
    title: clean(item.match(/<title>([\s\S]*?)<\/title>/)?.[1] ?? null) || "",
    published: parseRssDate(item.match(/<pubDate>([\s\S]*?)<\/pubDate>/)?.[1] ?? null),
    url: clean(item.match(/<link>([\s\S]*?)<\/link>/)?.[1] ?? null),
  })).filter((item) => item.title);
}

export async function oracleFeed(): Promise<{ state: "DETERMINISTIC" | "UNAVAILABLE"; observations: FeedObservation[]; error: string | null }> {
  try {
    const res = await fetch("https://www.federalreserve.gov/feeds/press_all.xml", { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return { state: "UNAVAILABLE", observations: [], error: `status ${res.status}` };
    return { state: "DETERMINISTIC", observations: parseRss(await res.text()).map((o) => ({ ...o, source: "federal-reserve-rss" })), error: null };
  } catch (err) {
    return { state: "UNAVAILABLE", observations: [], error: err instanceof Error ? err.message : "fetch failed" };
  }
}

export async function pulseFeed(): Promise<{ state: "DETERMINISTIC" | "UNAVAILABLE"; observations: FeedObservation[]; error: string | null }> {
  try {
    const res = await fetch("https://www.sec.gov/news/pressreleases.rss", { headers: { "user-agent": "apex-quant-x research contact@example.com" }, signal: AbortSignal.timeout(8000) });
    if (!res.ok) return { state: "UNAVAILABLE", observations: [], error: `status ${res.status}` };
    return { state: "DETERMINISTIC", observations: parseRss(await res.text()).map((o) => ({ ...o, source: "sec-press-rss" })), error: null };
  } catch (err) {
    return { state: "UNAVAILABLE", observations: [], error: err instanceof Error ? err.message : "fetch failed" };
  }
}

export async function voltaFeed(): Promise<{ state: "DETERMINISTIC" | "UNAVAILABLE"; observations: FeedObservation[]; error: string | null }> {
  try {
    const res = await fetch("https://query1.finance.yahoo.com/v8/finance/chart/%5EVIX?interval=1d&range=5d", { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return { state: "UNAVAILABLE", observations: [], error: `status ${res.status}` };
    const body = await res.json() as { chart?: { result?: Array<{ meta?: { regularMarketPrice?: number; regularMarketTime?: number } }> } };
    const price = body.chart?.result?.[0]?.meta?.regularMarketPrice;
    const time = body.chart?.result?.[0]?.meta?.regularMarketTime;
    if (price == null) return { state: "UNAVAILABLE", observations: [], error: "no VIX price" };
    return { state: "DETERMINISTIC", observations: [{ source: "yahoo-vix", title: `VIX ${price}`, published: time ? new Date(time * 1000).toISOString() : null, url: "https://finance.yahoo.com/quote/%5EVIX" }], error: null };
  } catch (err) {
    return { state: "UNAVAILABLE", observations: [], error: err instanceof Error ? err.message : "fetch failed" };
  }
}
