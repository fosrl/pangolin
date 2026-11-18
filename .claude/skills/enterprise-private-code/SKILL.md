---
name: enterprise-private-code
description: Use whenever a task touches `server/private/`, adds an enterprise-only or SaaS-only feature, uses or adds a `#private/...` or `#dynamic/...` import, needs different behaviour on OSS vs enterprise builds, adds a private config value (privateConfig.yml / privateConfigSchema), or adds enterprise-only DB tables (privateSchema.ts).
---

Read `docs/enterprise-private-code.md` before writing code. Key rules:

- `server/private/**` is compiled only into the enterprise and saas builds. Every
  file there starts with the Fossorial Commercial License header (copy it from
  any existing private file; `license_header_checker.py` checks it).
- **Inside `server/private/`**: import private files with `#private/...`. Never
  use `#dynamic` there.
- **Outside `server/private/`**: never import `#private`. Use `#dynamic/<path>`,
  which resolves to `server/private/<path>` on enterprise/saas and
  `server/<path>` on oss.
- So every `#dynamic` module needs **two files with identical exports**: the real
  one at `server/private/<path>.ts` and an OSS stub or reduced version at
  `server/<path>.ts`. Examples: `server/middlewares/logActionAudit.ts` (no-op) ↔
  `server/private/middlewares/logActionAudit.ts`;
  `server/lib/blueprints/MaintenanceSchema.ts` (empty schema) ↔
  `server/private/lib/blueprints/MaintenanceSchema.ts`.
- Private-only routes go in `server/private/routers/{external,internal,integration,hybrid}.ts`
  and need no stub.
- Private config keys go in `privateConfigSchema` in
  `server/private/lib/readConfigFile.ts` and are read through
  `privateConfig.getRawPrivateConfig()` from `#private/lib/config`. They never go
  in the public `server/lib/readConfigFile.ts`.
- Enterprise-only tables go in `server/db/{pg,sqlite}/schema/privateSchema.ts`
  (both dialects).

Verify by type-checking both builds: `npm run set:oss && npx tsc --noEmit`, then
`npm run set:enterprise && npx tsc --noEmit`. Afterwards, restore whichever
build was active (check `server/build.ts` first).
