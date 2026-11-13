# Grok Bot setup

These Bots are not connected. No webhook URL is stored here.

For each role in src/lib/apex/bots/registry.ts:

1. Create the Bot in grok.com with that exact name.
2. Paste its standing purpose. It may research only. It may not trade or change flags.
3. Copy the Bot id into a local secret store. Do not commit it.
4. Point its routine at an Apex ingest endpoint you control.
5. Send a test result and confirm accept() marks it authenticated.

Hermes may read a sanitized journal and propose an experiment. It cannot promote a strategy.

EXPERIMENT_ON=false
PAPER_AUTO=false
LIVE=false
