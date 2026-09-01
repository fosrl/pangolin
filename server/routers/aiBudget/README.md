# AI Budget API

Public/OSS CRUD entity (`server/routers/aiBudget/`, not enterprise-gated).
Table: `aiBudgets` in `server/db/{pg,sqlite}/schema/schema.ts`, type `AiBudget`.

## What a budget is

A row is a spend/usage cap of `amount` `unit` (`usd` | `tokens`) per `period`
(`hourly` | `daily` | `weekly` | `monthly` | `yearly` | `lifetime`), with
`enforcement` (`hard` | `soft`) and an `enabled` flag.

Every budget belongs to an org (`orgId`, required) and is optionally further
scoped to **exactly one** of:

- `providerId` → an `aiProviders` row
- `modelId` → an `aiModels` row
- `resourceId` → a `resources` row
- `siteResourceId` → a `siteResources` row
- `roleId` → a `roles` row

If none of those five are set, the budget is **org-wide**. Setting more than
one at once is rejected by `validation.ts`'s `refineBudgetScopeFields`
(`400`, "Only one of providerId, modelId, resourceId, siteResourceId, or
roleId may be set on a budget").

## Uniqueness / conflict rule

A given scope (one specific provider, or model, or resource, or site
resource, or role, or "org-wide") may have **multiple** budgets, but at most
**one per `(unit, period)` combination** — e.g. one `weekly`/`usd` budget and
one `hourly`/`usd` budget can coexist on the same provider, but two
`weekly`/`usd` budgets cannot. This is enforced at two levels:

- DB: composite `unique` constraints in both schema files —
  `ai_budget_provider_uniq (providerId, unit, period)`,
  `ai_budget_model_uniq (modelId, unit, period)`,
  `ai_budget_resource_uniq (resourceId, unit, period)`,
  `ai_budget_site_resource_uniq (siteResourceId, unit, period)`,
  `ai_budget_role_uniq (roleId, unit, period)`. (NULL scope columns never
  collide under a plain unique index, so this does *not* cover the org-wide
  case — see next bullet.)
- App: `createAiBudget`/`updateAiBudget` both run an explicit pre-check
  query keyed on `(scopeCondition, unit, period)` before insert/update,
  where `scopeCondition` is `eq(<scopeColumn>, id)` for whichever scope
  field is set, or — when none is set — `orgId = X AND` all five scope
  columns `IS NULL`, so org-wide budgets get the same one-per-`(unit,
  period)` guarantee even though the DB constraint can't express it.
  Violating this returns `409` with
  `` `A ${period} ${unit} budget already exists for this scope` ``.

Because only one row can ever exist for a given `(scope, unit, period)`,
there is no separate check needed to prevent a `hard` and a `soft` budget
from coexisting on the same `(scope, unit, period)` — the conflict check
above already blocks the second row regardless of its `enforcement` value.

On `updateAiBudget`, the conflict/ownership checks are run against the
**merged** next-state (existing row's scope/unit/period overlaid with
whatever the request body changes), not just the fields present in the
body — so e.g. changing only `unit` on a budget that already has
`providerId` set re-validates against that provider's other budgets at the
new unit.

## Ownership validation

`providerId`/`modelId`/`resourceId`/`siteResourceId`/`roleId` are validated
to belong to the same `orgId` as the budget (`modelId` via an
`aiModels ⋈ aiProviders` join, since `aiModels` has no `orgId` column
directly). A mismatch returns `404`, not `403` — this matches how the
sibling `aiProvider`/`aiModel` routers report cross-org references.

## Routes

All under `server/routers/external.ts`, registered right after the
`aiProvider`/`aiModel` block. `PUT` = create, `POST` = update (repo
convention, not standard REST).

| Method | Path | Middleware | Action | Handler |
|---|---|---|---|---|
| PUT | `/org/:orgId/ai-budget` | `verifyOrgAccess` | `createAiBudget` | `createAiBudget` |
| GET | `/org/:orgId/ai-budgets` | `verifyOrgAccess` | `listAiBudgets` | `listAiBudgets` (paginated) |
| GET | `/ai-budget/:budgetId` | `verifyAiBudgetAccess` | `getAiBudget` | `getAiBudget` |
| POST | `/ai-budget/:budgetId` | `verifyAiBudgetAccess` | `updateAiBudget` | `updateAiBudget` |
| DELETE | `/ai-budget/:budgetId` | `verifyAiBudgetAccess` | `deleteAiBudget` | `deleteAiBudget` |
| GET | `/ai-provider/:providerId/ai-budgets` | `verifyAiProviderAccess` | `listAiBudgets` | `listAiBudgetsForProvider` |
| GET | `/ai-model/:modelId/ai-budgets` | `verifyAiModelAccess` | `listAiBudgets` | `listAiBudgetsForModel` |
| GET | `/resource/:resourceId/ai-budgets` | `verifyResourceAccess` | `listAiBudgets` | `listAiBudgetsForResource` |
| GET | `/site-resource/:siteResourceId/ai-budgets` | `verifySiteResourceAccess` | `listAiBudgets` | `listAiBudgetsForSiteResource` |
| GET | `/role/:roleId/ai-budgets` | `verifyRoleAccess` | `listAiBudgets` | `listAiBudgetsForRole` |

The five scope-filtered `GET .../ai-budgets` routes intentionally reuse the
single `ActionsEnum.listAiBudgets` action rather than getting one action
each — access control is already fully handled by the entity-specific
middleware (a user who can see the provider/resource/etc. can see its
budgets), so per-scope actions would just be enum bloat. They also skip
pagination (unlike the org-wide list) since a single entity realistically
has only a handful of `(unit, period)` budgets — response shape is a flat
`{ budgets: AiBudget[] }` (`ListAiBudgetsByScopeResponse`), not
`PaginatedResponse`.

`verifyAiBudgetAccess` (`server/middlewares/verifyAiBudgetAccess.ts`) loads
the budget by `budgetId`, resolves its `orgId` directly off the row (no
join needed, unlike `verifyAiModelAccess`), and stashes it on
`req.aiBudget` so `getAiBudget`/`updateAiBudget` can skip a re-fetch.

## Request/response shapes

- Create body: `providerId?`, `modelId?`, `resourceId?`, `siteResourceId?`,
  `roleId?` (all `number`, mutually exclusive), `amount` (positive
  `number`, required), `unit` (required), `period` (default `"monthly"`),
  `enforcement` (default `"hard"`), `enabled?` (default `true`).
- Update body: same fields, all optional; the five scope fields are
  `nullable().optional()` so a client can explicitly send `null` to clear
  a scope (turning a scoped budget into an org-wide one).
- All five CRUD responses wrap a single `budget: AiBudget` (or
  `budgets: AiBudget[]` + `pagination` for the org-wide list). No public/
  private mapper exists for `AiBudget` — unlike `AiProvider`, there's no
  secret field to strip, so the raw DB row is returned as-is.

## Not yet migrated

Schema changes here (composite unique constraints) were made directly in
`schema.ts` without hand-writing a `server/migrations/*.sql` file — this
repo's CI (`.github/workflows/test.yml`) runs `drizzle-kit generate`
against `schema.ts` fresh, and other recent schema-only commits (e.g. "Remove
budget periods") follow the same pattern of not committing a matching
migration by hand.
