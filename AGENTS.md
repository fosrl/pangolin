# Pangolin — agent guide

Pangolin is an identity-aware reverse proxy / VPN with a dashboard. The repo holds
an Express API server (`server/`) and a Next.js dashboard (`src/`) that share
types via path aliases. Read this file first. It holds the hard rules and points
to the detailed docs so you don't have to search for where things live.

## Detailed docs (read the one that matches your task)

| Topic | File |
| --- | --- |
| Where everything lives (directory map) | `docs/repo-map.md` |
| Public vs private resources, tables, routes, blueprint sync | `docs/resources.md` |
| Enterprise code: `server/private`, `#private`, `#dynamic`, stubs, private config | `docs/enterprise-private-code.md` |
| DB schema (SQLite + Postgres parity), migrations, encrypting secrets | `docs/database.md` |
| Dashboard UI conventions (Credenza, banners, tabs, pages vs modals, i18n) | `docs/ui-conventions.md` |
| Building a CRUD endpoint | `docs/crud-endpoints.md` |

## Hard rules

### Naming
- **Public resource = proxy resource = `resource`**, stored in the **`resources`** table, code in `server/routers/resource/`.
- **Private resource = site resource = client resource = `siteResource`**, stored in the **`siteResources`** table, code in `server/routers/siteResource/`.
- "Every resource" means both kinds: a change to resources usually needs the same change on site resources.

### Resources and blueprints
- When you change `createResource` / `updateResource` or `createSiteResource` / `updateSiteResource` (new field, renamed field, new mode), also update the **blueprint** schema and apply/export logic so the same thing can be done from a blueprint. See the checklist in `docs/resources.md`.
- Every resource route on the **integration API** (`server/routers/integration.ts`, `server/private/routers/integration.ts`) needs a `public-resource` alias next to the legacy `resource` path. Site resource routes need a `private-resource` alias next to `site-resource`. Register both paths in OpenAPI.

### Database
- The app runs on **SQLite or Postgres**. Every table change goes in **both** `server/db/pg/schema/*.ts` and `server/db/sqlite/schema/*.ts`, and the two must match.
- Use only portable column types. No Postgres-only features: no `timestamp`/`date` columns, no `json`/`jsonb`, no enums, no arrays. Store times as epoch numbers (`bigint({mode:"number"})` in pg, `integer` in sqlite) or ISO strings (`varchar`/`text`). Store JSON as `text`.
- **Never write migrations** (`server/setup/scripts*/`, `migrations*.ts`, SQL). They're generated for each release with drizzle. Instead, write migration notes in `server/setup/migrationNotes/<next-untagged-version>.md`, or update that file if it already exists. The notes cover what drizzle can't do: copying values, generating values for existing rows, renames, backfills, encryption, config changes. See `docs/database.md` § Migration notes.
- **Encrypt sensitive values** (secrets, API keys, client secrets, passwords that must be recovered) with `encrypt`/`decrypt` from `@server/lib/crypto`, keyed with `config.getRawConfig().server.secret!`. Values that only need verifying get hashed instead.

### Enterprise / private code
- Everything in `server/private/` ships only in the enterprise and SaaS builds. Every file there needs the Fossorial Commercial License header (see `license_header_checker.py`).
- Inside `server/private/`, import other private files with `#private/...`. Never use `#dynamic` there.
- Outside `server/private/`, **never** import `#private`. Use `#dynamic/...`. It resolves to `server/private/<path>` on enterprise/SaaS builds and `server/<path>` on OSS builds. So you need **both files**: the real one in `server/private/...` and an OSS stub (or reduced version) at the same relative path in `server/...` with the same exports.
- Private config values go in `server/private/lib/readConfigFile.ts` (`privateConfigSchema`) and are read through `privateConfig` from `#private/lib/config`. They don't go in the public `server/lib/readConfigFile.ts`. Private DB tables go in `server/db/{pg,sqlite}/schema/privateSchema.ts`.

### UI
- **Translate every user-facing string** with `t("key")` (`useTranslations()` in client components, `await getTranslations()` from `next-intl/server` in server components). Don't hard-code strings in the UI, including toasts, labels, placeholders, descriptions and tab titles.
- **Never write translations.** Add new keys **only** to `messages/en-US.json`. Never edit the other `messages/*.json` files; Crowdin generates them.
- Use **Credenza** (`@app/components/Credenza`) for every modal or dialog. Don't use `Dialog`, `Sheet`, `Drawer` or `AlertDialog` directly.
- For informational or help content on a page, use a **`DismissableBanner`** (`@app/components/DismissableBanner`), not an `Alert`.
- If an object has more than a handful of settings, give it **pages** (a list page, a create page, and `[id]/<tab>` pages with a `layout.tsx` + `HorizontalTabs`) rather than a modal. Keep Credenzas for small, quick forms and confirmations.
- Forms use `react-hook-form` with `zodResolver` and a zod schema.
- Submit buttons use the `loading` prop. Don't change the button text while loading.
- Prefer `type` over `interface` in TypeScript.

### API verb convention
`PUT` = create, `POST` = update. Don't "fix" this.

## Commands

- `npm run dev` runs the API server (tsx watch). The Next app is served by the same process.
- `npx tsc --noEmit` type-checks. The active build and DB driver come from `tsconfig.json` and `server/build.ts` / `server/db/index.ts`, which are gitignored and **generated** by `npm run set:{oss,enterprise,saas}` and `npm run set:{sqlite,pg}`. Switch builds with those scripts instead of editing the files by hand. Type-check under both `set:oss` and `set:enterprise` when you touch `#dynamic` code.
- `npm run format` / `npm run format:check` run Prettier (4-space indent).
- `npm test` runs the tests.
