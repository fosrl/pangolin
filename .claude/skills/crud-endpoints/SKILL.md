---
name: crud-endpoints
description: Use whenever asked to add, create, or scaffold a CRUD endpoint, router, or entity in this repo's server (create/list/get/update/delete handlers, new `server/routers/<entity>/` or `server/private/routers/<entity>/` folder). Points to the established file layout, middleware, ActionsEnum, and route-registration conventions before writing any code.
---

Before writing any router/handler/middleware code for a new entity, read
`docs/crud-endpoints.md` in full. It documents, with real examples from
`server/routers/aiProvider/` (public) and `server/private/routers/alertRule/`
(enterprise-only), how this repo structures CRUD endpoints:

- Directory/file layout per entity (`index.ts`, `types.ts`, `validation.ts`,
  one file per operation).
- The standard handler anatomy (zod parsing, OpenAPI registry, response
  envelope, error handling).
- Where access-control middleware (`verify<Entity>Access`) lives and when
  it's needed vs. plain `verifyOrgAccess`.
- How to wire up `ActionsEnum` entries, `verifyUserHasAction`, and
  `logActionAudit`.
- Which of the four router files (`server/routers/external.ts`,
  `server/routers/internal.ts`, `server/private/routers/external.ts`,
  `server/private/routers/internal.ts`) to register routes in, and the
  middleware chain template per HTTP verb.
- The repo's non-standard verb convention: **`PUT` = create, `POST` =
  update** (backwards from typical REST) — don't "fix" this to standard
  REST verbs, match the existing convention.
- The `#dynamic` import alias, for the rare case of a hook needing different
  implementations in OSS vs. enterprise builds.

Follow that doc's checklist (§8) step by step rather than improvising a
structure. If the doc and the actual code in `aiProvider`/`alertRule` ever
disagree, trust the code and flag the doc as stale.
