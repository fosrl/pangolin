---
name: db-schema-change
description: Use whenever adding, renaming or removing a database table or column (Drizzle schema in `server/db/pg/schema/` or `server/db/sqlite/schema/`), when migrations or migration notes come up, when choosing column types for dates, JSON, enums or booleans, or when storing secrets, API keys, tokens or credentials in the database.
---

Read `docs/database.md` before editing a schema. Key rules:

- Pangolin runs on **SQLite or Postgres**. Make every change in **both**
  `server/db/pg/schema/<file>.ts` and `server/db/sqlite/schema/<file>.ts`
  (`schema.ts`, or `privateSchema.ts` for enterprise-only tables) with matching
  names, nullability, defaults and FKs.
- **Portable types only.** No `timestamp`/`date`, `json`/`jsonb`, `pgEnum`,
  arrays, `uuid` type, or `defaultNow()`. Times are epoch numbers
  (`bigint({mode:"number"})` ↔ `integer`) or ISO strings (`varchar` ↔ `text`).
  JSON goes in `text`. Enums are `varchar/text().$type<...>()`. Booleans are
  `boolean` ↔ `integer({mode:"boolean"})`. Copy the pattern of a neighbouring
  column.
- **Never write migration scripts or SQL** (`server/setup/scriptsPg|scriptsSqlite/`,
  `migrations*.ts`). They're generated for each release with drizzle. Instead,
  write or update `server/setup/migrationNotes/<version>.md`, where `<version>`
  is the next untagged release. If a notes file newer than the latest
  `git tag --sort=-v:refname | head -1` already exists, append to it. Otherwise
  create the next minor and tell the user. Record only what drizzle can't do:
  data copies, generated values for existing rows, renames, NOT NULL backfills,
  encryption of existing data, config-key moves, SQLite/Postgres differences.
  The template is in `docs/database.md` § Migration notes.
- **Encrypt sensitive values** you need to read back with
  `encrypt(value, config.getRawConfig().server.secret!)` /
  `decrypt(...)` from `@server/lib/crypto`. Hash values you only need to verify
  (`hashPassword` from `@server/auth/password`).
- If the column backs a resource or site resource setting, also load the
  `resource-changes` skill (the blueprint must be updated too).
