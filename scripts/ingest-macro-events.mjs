import { mkdirSync, writeFileSync } from "node:fs";
const UA = "apex-quant-x research contact@example.com";
async function get(url) {
  const res = await fetch(url, { headers: { "user-agent": UA }, signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(`${url} ${res.status}`);
  return res.text();
}
function monthNum(name) { return { january:1,february:2,march:3,april:4,may:5,june:6,july:7,august:8,september:9,october:10,november:11,december:12 }[name.toLowerCase()]; }
function iso(y, m, d) { return `${y}-${String(m).padStart(2,"0")}-${String(d).padStart(2,"0")}`; }
function easternToUtc(date, hour, minute) {
  const target = `${date}T${String(hour).padStart(2,"0")}:${String(minute).padStart(2,"0")}`;
  const guess = new Date(`${target}:00Z`);
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour12: false, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).formatToParts(guess);
  const shown = `${parts.find(p=>p.type==="year").value}-${parts.find(p=>p.type==="month").value}-${parts.find(p=>p.type==="day").value}T${parts.find(p=>p.type==="hour").value}:${parts.find(p=>p.type==="minute").value}`;
  const utc = new Date(Date.parse(`${target}:00Z`) + (Date.parse(`${target}:00Z`) - Date.parse(`${shown}:00Z`)));
  return utc.toISOString();
}

const fomc = [];
for (let year = 1994; year <= 2020; year++) {
  const url = `https://www.federalreserve.gov/monetarypolicy/fomchistorical${year}.htm`;
  const text = await get(url);
  for (const block of text.split(/<h5[^>]*>/).slice(1)) {
    const heading = block.match(/^([^<]+)/)?.[1]?.trim();
    if (!heading) continue;
    const statement = block.match(/href="([^"]*pressreleases\/monetary[^"]+)"/)?.[1] || null;
    const cancelled = /cancelled|canceled/i.test(heading);
    const notation = /notation vote/i.test(heading);
    const unscheduled = /unscheduled|conference call/i.test(heading);
    const dates = [...heading.matchAll(/([A-Z][a-z]+)\s+(\d{1,2})(?:-(\d{1,2}))?/g)];
    const last = dates.at(-1);
    if (!last) continue;
    const month = monthNum(last[1]);
    fomc.push({
      eventType: "FOMC", year, heading,
      meetingStart: dates[0] ? iso(year, monthNum(dates[0][1]), Number(dates[0][2])) : null,
      statementDate: cancelled ? null : iso(year, month, Number(last[3] || last[2])),
      statementUrl: statement ? new URL(statement, "https://www.federalreserve.gov").toString() : null,
      status: cancelled ? "CANCELED" : notation ? "NOTATION_VOTE" : unscheduled ? "UNSCHEDULED" : "SCHEDULED",
      statementTimeEt: null, statementTimeUtc: null, timeStatus: cancelled || notation ? "NOT_APPLICABLE" : "UNVERIFIED",
      source: url,
    });
  }
}
const current = await get("https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm");
for (const [id, yearText] of [...current.matchAll(/id="(\d+)"[\s\S]{0,200}?>(20\d{2})</g)]) {
  const year = Number(yearText);
  if (year < 2021 || year > 2026) continue;
  const start = current.indexOf(`id="${id}"`);
  const next = current.indexOf('id="', start + 4);
  const block = current.slice(start, next > start ? next : start + 20000);
  for (const meeting of block.split(/fomc-meeting__month/).slice(1)) {
    const monthName = meeting.match(/<strong>([A-Za-z]+)<\/strong>/)?.[1];
    const dateText = meeting.match(/fomc-meeting__date[^>]*>([^<]+)/)?.[1]?.trim();
    if (!monthName || !dateText || !monthNum(monthName)) continue;
    const days = dateText.replace("*","").match(/(\d{1,2})(?:-(\d{1,2}))?/);
    if (!days) continue;
    const month = monthNum(monthName);
    const statement = meeting.match(/href="(\/newsevents\/pressreleases\/monetary[^"]+)"/)?.[1] || null;
    fomc.push({
      eventType: "FOMC", year, heading: `${monthName} ${dateText} Meeting - ${year}`,
      meetingStart: iso(year, month, Number(days[1])),
      statementDate: iso(year, month, Number(days[2] || days[1])),
      statementUrl: statement ? `https://www.federalreserve.gov${statement}` : null,
      status: "SCHEDULED", statementTimeEt: "14:00", statementTimeUtc: easternToUtc(iso(year, month, Number(days[2] || days[1])), 14, 0),
      timeStatus: "CONVENTION_2PM_ET_NOT_PAGE_VERIFIED",
      source: "https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm",
    });
  }
}
const cpi = [];
for (let year = 2000; year <= 2026; year++) {
  const url = `https://www.bls.gov/schedule/${year}/home.htm`;
  try {
    const text = await get(url);
    for (const row of text.split("<tr").slice(1)) {
      if (!/Consumer Price Index/i.test(row)) continue;
      const date = row.match(/date-cell[\s\S]*?>(?:<p>)?([A-Za-z]+,\s+[A-Za-z]+\s+\d{1,2},\s+\d{4})/)?.[1];
      const time = row.match(/time-cell[\s\S]*?>(?:<p>)?(\d{1,2}:\d{2}\s*[AP]M)/)?.[1];
      const ref = row.match(/for\s+([A-Za-z]+\s+\d{4})/i)?.[1] || null;
      if (!date) continue;
      const parsed = new Date(date);
      const statementDate = parsed.toISOString().slice(0,10);
      cpi.push({
        eventType: "CPI", referencePeriod: ref, statementDate, statementTimeEt: time || null,
        statementTimeUtc: time === "08:30 AM" ? easternToUtc(statementDate, 8, 30) : null,
        status: "SCHEDULED", originalValueStatus: "NOT_RETRIEVED",
        source: url, timeStatus: time ? "SCHEDULE_TIME" : "MISSING_TIME",
      });
    }
  } catch (err) {
    cpi.push({ eventType: "CPI", year, status: "SOURCE_UNAVAILABLE", error: err.message, source: url });
  }
  console.log("cpi", year, cpi.filter(e => e.statementDate?.startsWith(String(year))).length);
}
mkdirSync("research/data/raw/events", { recursive: true });
writeFileSync("research/data/raw/events/fomc.json", JSON.stringify(fomc, null, 2));
writeFileSync("research/data/raw/events/cpi.json", JSON.stringify(cpi, null, 2));
console.log(JSON.stringify({ fomc: fomc.length, cpi: cpi.length, years: [...new Set(fomc.map(e=>e.year))] }, null, 2));
