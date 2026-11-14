import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const html = readFileSync(new URL("../public/mission.html", import.meta.url), "utf8");

test("keeps mock and disabled labels", () => {
  assert.match(html, /Paper: DISABLED/);
  assert.match(html, /XAI: MOCK/);
  assert.match(html, /UNAVAILABLE/);
});

test("draws arrows from recorded source and destination only", () => {
  assert.match(html, /edge\.source/);
  assert.match(html, /edge\.destination/);
  assert.match(html, /state\.conversations/);
  assert.match(html, /type !== "conversation"/);
});

test("does not invent bull/bear conversations and avoids HTML interpolation", () => {
  assert.doesNotMatch(html, /conversations\.push/);
  assert.match(html, /none recorded/);
  assert.doesNotMatch(html, /innerHTML/);
});

test("heartbeat and quotes do not force a network redraw", () => {
  assert.doesNotMatch(html, /health: \[state\.pid, state\.heartbeat/);
  assert.match(html, /updatePanels/);
  assert.match(html, /MOCK submissions/);
});

test("chart has price and date labels", () => {
  assert.match(html, /toLocaleString/);
  assert.match(html, /bars\[i\]\.date/);
});
