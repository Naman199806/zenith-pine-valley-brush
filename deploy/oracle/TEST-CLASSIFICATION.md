# Test classification

Nine fresh-restore failures are Grok template checks, not Apex trading tests.

They look for SKILL.md, AGENTS.md, shipped app-env, auth-off, and nitro template assets.
Those files are not copied into the Oracle image.
Auth-off settings must not be used in production.
Remote dashboard access must require authentication.

Apex application tests in src/lib/apex passed in the prior restore.
