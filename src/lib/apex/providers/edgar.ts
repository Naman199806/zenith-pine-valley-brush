export interface Filing {
  cik: string;
  ticker: string;
  form: string;
  filed: string;
  url: string;
}

export async function spyFilings(): Promise<Filing[]> {
  const res = await fetch("https://data.sec.gov/submissions/CIK0000884394.json", {
    headers: { "User-Agent": "ApexQuantX research admin@example.com", Accept: "application/json" },
  });
  if (!res.ok) return [];
  const body = await res.json() as { filings?: { recent?: { form?: string[]; filingDate?: string[]; accessionNumber?: string[] } } };
  const recent = body.filings?.recent;
  if (!recent?.form) return [];
  return recent.form.slice(0, 5).map((form, i) => ({
    cik: "0000884394",
    ticker: "SPY",
    form,
    filed: recent.filingDate?.[i] ?? "",
    url: "https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=0000884394",
  }));
}
