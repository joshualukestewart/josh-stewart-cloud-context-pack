<!--
GENERATED FILE - DO NOT EDIT BY HAND.

Source of truth: AGENTS.md and .agents/skills/.
Regenerate with:  npm run generate
Verify in CI with: npm run check
-->

# GitHub Copilot instructions

Read [AGENTS.md](../AGENTS.md) first and follow it
as the canonical operating contract.

Pack version `0.3.0-pre.2` (status: `pre-release`), 9 canonical skills.

Load only the skill matching the task from `.github/skills/`; native skill
discovery carries each skill description on demand, so it is not duplicated here.

- Stay within the requested scope. If no skill matches, do not load one or add secondary advice.
- Never introduce secrets or private identifiers; use managed identity and OIDC.
- Retrieve volatile Microsoft facts live via `https://learn.microsoft.com/api/mcp` or a primary source; do not guess.
- Preserve the consuming repository conventions and run the smallest relevant verification.
