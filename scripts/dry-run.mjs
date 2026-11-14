import { writeFileSync } from "node:fs";
import { btcPacket } from "../src/lib/apex/bots/packet.ts";
import { cycle } from "../src/lib/apex/research/roles.ts";

const mock = { async complete() { return { text: JSON.stringify({ stance: "DEFER" }), tokens: 1 }; } };
const out = await cycle(btcPacket(), mock, { quantOk: true, riskOk: true, strategyApproved: false });
const record = { startedAt: new Date().toISOString(), ...out, flags: { EXPERIMENT_ON: false, PAPER_AUTO: false, LIVE: false } };
writeFileSync("/workspace/research/lab/dry-run-cycle.json", JSON.stringify(record, null, 2));
console.log(JSON.stringify({ action: out.decision.action, roles: out.roles.length, paidCalls: 0, brokerWrites: 0 }));
