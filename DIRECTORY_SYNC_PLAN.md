# Plan: IdP API integration (JIT enrichment + directory sync)

Covers Microsoft Entra ID (`azure`) and Google Workspace (`google`). Generic OIDC IdPs have no API integration.

## Configuration flow

An admin configures an IdP in three steps.

### 1. Enable the API integration

This turns the IdP from plain OIDC into a tighter integration that unlocks the features below, and possibly more later.

- Each provider has its own fields:
  - **Google:** service account JSON key, admin email to impersonate (optional), customer ID (optional).
  - **Azure:** reuses the OIDC client ID and secret. The tenant ID is parsed from `authUrl` for now.
- The fields are stored encrypted in `idp.directorySyncConfig` ([idpDirectorySyncConfig.ts](src/lib/idpDirectorySyncConfig.ts), [config.ts](server/private/lib/directorySync/config.ts)).
- The integration on its own doesn't provision anyone. It only makes the API available to JIT and sync.

### 2. How users are created

The admin can turn on any combination of these three methods.

| Method | When it runs | Needs the API integration |
| --- | --- | --- |
| **Manual** (default) | An admin pre-provisions users | No |
| **Just in time (JIT)** | At login, in the OIDC callback | No, but it uses the API when enabled |
| **Sync** | Background job on an interval | Yes |

**Manual**

- When manual is off, the IdP doesn't appear on the create-user page, and the create-user API rejects that IdP.

**Just in time** (the existing `autoProvision` field, unchanged in the DB and API)

- When the API integration is enabled, the callback fetches the user's groups (and any other extra data) from the provider. The groups are injected into the claims as `groups` before any mapping runs.
  - On Google, ID tokens never carry groups, so this is the only way JIT can map groups to roles.
  - On Azure, it also covers the groups overage case (more than 200 groups puts `_claim_names` in the token instead of `groups`) and apps that weren't configured to emit the `groups` claim.
- If the API call fails, log a warning and continue with the token claims only. Login must not break because of the API.
- The org and role mappings for JIT run on these claims (see [step 3](#3-org-and-role-mappings)).

**Sync** (routine-based background sync)

- Fetches every user and their transitive groups from the provider.
- For each user, it builds a **claims payload** that mirrors the provider's ID token as closely as the API allows (see [Sync claims payload](#sync-claims-payload)). It's fine for some token claims to be missing.
- Sync then runs the same pipeline as JIT on that payload:
  1. `identifierPath` gives the username.
  2. The org mapping decides whether the user is in the org.
  3. The role mapping decides the roles.

  Because the identifier and the mappings are the same JMESPath that login runs, a synced user and the same person logging in end up with the same `users.username`.

### 3. Org and role mappings

Mappings are stored per method: one set for JIT, one set for sync.

- **One editor by default.** The UI shows a single mapping editor that writes to both the JIT and the sync columns, so admins don't define their mappings twice.
- **Advanced toggle: "Configure JIT and sync separately".** It splits the editor in two. This lets an admin map orgs or roles differently per method to avoid conflicts. Most people won't need it.

**Org mapping**

- A JMESPath expression that decides whether the user is added to the org.
- It runs before the role mapping.
- It must return `true`, `false`, or the orgId.
- `{{orgId}}` is replaced with the org's ID before evaluation (`hydrateOrgMapping` already does this for JIT).

**Role mapping**

- Three modes, with the mapping builder as the default:
  - **Mapping builder:** group → roles rules.
  - **Fixed roles:** every user gets the same roles.
  - **JMESPath expression:** the current JIT behavior.
- **Create missing roles** is a separate option. It is no longer tied to a mode. When it's on, every role name the mapping returns that doesn't exist in the org gets created.
- The current sync-only `automatic` mode (role name = group display name) becomes the mapping builder with a "use the group name" rule, or a JMESPath expression such as `groups`, plus "Create missing roles". It isn't kept as its own mode.

## Sync claims payload

A documented JSON object per user that mirrors the provider's ID token. Only claims we can source from the API are included. Token metadata (`iss`, `aud`, `azp`, `iat`, `exp`, `nbf`, `at_hash`, `sid`, `uti`, `rh`, `ver`) is never included.

### Azure (Microsoft Graph)

Verified on a test tenant: the token's `oid` claim equals the Graph user `id`, so `oid` is the external ID.

| Claim | Graph source | Matches the token? |
| --- | --- | --- |
| `oid` | `id` | ✅ Same value |
| `tid` | tenant ID | ✅ |
| `name` | `displayName` | ✅ |
| `email` | `mail`, falling back to `otherMails[0]` | ⚠️ Usually. The token claim is optional. |
| `preferred_username` | `userPrincipalName` | ⚠️ Matches for members. For guests, the token has the real email, but Graph has `user_domain#EXT#@tenant.onmicrosoft.com`. |
| `groups` | transitive group **object IDs** | ✅ Same format: the token's `groups` claim also holds object IDs, not names. It's optional in the token (only present when the app emits it), but sync always includes it. |
| `sub` | — | ❌ Can't be built: it's a pairwise ID per app |
| `wids` | — | Not included. It's optional in the token and holds directory role template IDs, which aren't useful for mappings. |
| `idp` | — | Not included. It's only present for guest accounts. |

Extra field outside the token: `groupNames` (display names). This lets the mapping builder match on names while `groups` stays token-compatible.

**Identifier:** an Azure IdP using sync must have an `identifierPath` that resolves from the payload. `oid` is the recommended value; `sub` is refused when sync is enabled.

### Google (Admin SDK Directory API)

Verified: the token's `sub` equals the Directory user `id`, so `sub` is the external ID. `sub` is also the same across OAuth clients (unlike Entra's `sub`).

| Claim | Directory source | Matches the token? |
| --- | --- | --- |
| `sub` | `id` | ✅ Same value |
| `email` | `primaryEmail` | ✅ |
| `email_verified` | always `true` | ✅ |
| `name` | `name.fullName` | ✅ |
| `given_name` / `family_name` | `name.givenName` / `name.familyName` | ✅ |
| `hd` | the primary email's domain | ✅ The token only has it for Workspace accounts, and every synced user is one |
| `picture` | — | Not included. The Directory `thumbnailPhotoUrl` is a different URL. |
| `groups` | transitive group emails | — Not in the token. Same shape that JIT injects. |

Extra field: `groupNames`.

### Shared rules

- Disabled, suspended or archived users get no orgs, whatever the mappings return.
- JIT enrichment and sync build `groups` / `groupNames` with the **same provider function**, so a mapping can't behave differently between the two.

## JIT and sync writing the same memberships

This is the main design risk. Both methods can now be on at once, and both write `userOrgs` and `userOrgRoles`. Each membership row records which method created it:

- `userOrgs.autoProvisioned` covers JIT.
- `userOrgs.directorySynched` covers sync.

The rules:

- Each method only removes or re-roles the rows it owns. Manually created rows (both flags `false`) are never touched.
- If a row is owned by one method and the other method also matches the user, it adds its flag. The row is only removed when no method still claims it.
- Roles: each method replaces only the roles it granted. We can track this per role on `userOrgRoles` (e.g. a `source` column), or simply recompute the full role set from whichever methods are on. **To decide.**
- If the two methods use different mappings, the user's roles flip back and forth between logins and sync runs. The UI should warn about this when the mappings are split.

## Data model changes (pg and sqlite, plus migrations)

**`idp`**

- `apiIntegrationEnabled`: rename or reuse `directorySyncEnabled`.
- `directorySyncConfig`: kept (the encrypted provider credentials).
- `allowManualProvisioning`: new, default `true`.
- `autoProvision`: kept as is in the DB and API, and it means JIT. Only the UI may label it "Just in time".
- `directorySyncEnabled`: now means "sync on". Requires the API integration.
- Remove the `autoProvision` ⟂ `directorySyncEnabled` exclusivity check in the global and org IdP create/update routes.
- `defaultOrgMapping` / `defaultRoleMapping` become separate JIT and sync variants for global IdPs.

**`idpOrg`**

- Replace `orgMapping`, `roleMapping` and `directoryRoleMapping` with:
  - `jitOrgMapping`
  - `jitRoleMapping`
  - `syncOrgMapping`
  - `syncRoleMapping`
  - `mappingsLinked` (boolean): the UI's "one editor" state.
- The role mappings use a single serialized config: `{ mode: "builder" | "fixed" | "jmespath", createMissingRoles, ... }`. This extends [idpDirectorySyncRoleMapping.ts](src/lib/idpDirectorySyncRoleMapping.ts) and replaces the JIT `roleMapping` format from [idpRoleMapping.ts](src/lib/idpRoleMapping.ts).
- The migration copies the existing `orgMapping` / `roleMapping` into both the JIT and the sync columns.
- `directorySyncDeletions`: kept, scoped to sync.

**Sync state.** `idpSyncState` and `idpSyncUser` were dropped (migration 0031). We'll need run state again for the scheduler: `lastSyncStartedAt`, `lastSyncSucceededAt`, `lastError`, `consecutiveFailures`, `nextSyncAt`, plus the Azure delta cursor. Add it back as columns on `idp` or as one small table.

## Sync engine

The current code lives in [server/private/lib/directorySync/](server/private/lib/directorySync/).

**Providers** ([azure.ts](server/private/lib/directorySync/azure.ts), [google.ts](server/private/lib/directorySync/google.ts))

- They keep returning the neutral `DirectoryUser` from [types.ts](server/private/lib/directorySync/types.ts).
- New per-provider function: `toClaims(user)`, which builds the sync claims payload.
- New per-provider function: `fetchUserGroups(externalId)`, used by JIT enrichment.

**Workflow** ([syncWorkflow.ts](server/private/lib/directorySync/syncWorkflow.ts))

Today the workflow sets `username` straight from the email and resolves roles with its own modes. It changes to:

1. Build the claims.
2. Apply `identifierPath`.
3. Evaluate the sync org mapping for each `idpOrg`.
4. Evaluate the sync role mapping.
5. Diff and apply.

**Shared mapping code**

- Pull the org/role evaluation out of [validateOidcCallback.ts](server/routers/idp/validateOidcCallback.ts) into a function that both JIT and sync call, e.g. `resolveOrgMemberships(claims, idpOrgs, method)`.
- Do the same for the "apply" half (upsert the user, add or remove orgs, re-sync roles), with ownership rules that depend on the method.

**Deprovisioning** keeps the safeguards from the previous plan:

- It's opt-in through `directorySyncDeletions`.
- It only touches rows the method owns.
- It never runs after a partial or failed fetch.
- A circuit breaker aborts the run on mass removals.
- Dry-run mode is already implemented.

**Scheduler**

- A tick runs every minute and syncs the IdPs that are due.
- A `LockManager` lock per IdP, plus exponential backoff on failures.
- Fixed sync interval: one constant in code, not configurable globally or per IdP.

## API and UI

**IdP settings**

- "API integration" section: a toggle plus the provider fields.
- "User provisioning" section: three toggles for Manual, JIT and Sync.
- Mappings section:
  - Org mapping.
  - Role mapping, with the builder as the default.
  - "Create missing roles".
  - "Configure JIT and sync separately" toggle.
- Sync status card and a "Sync now" button.

**Create user page / API**

- Filter out IdPs with `allowManualProvisioning = false`.

**Endpoints**

- `POST /idp/:idpId/sync` ("Sync now", with a dry-run option).
- `GET /idp/:idpId/sync-status`.

**Docs**

- The claims payload per provider (the tables above).
- Setup: Azure application permissions plus admin consent; Google domain-wide delegation scopes.

## Phases

1. **Mapping refactor:**
   - Unified role-mapping config.
   - Split JIT and sync columns, with a migration.
   - Extract the shared evaluate/apply code from the OIDC callback, with no change in behavior.
2. **Provisioning flags:**
   - Manual on/off, plus the create-user filtering.
   - Drop the JIT ⟂ sync exclusivity.
   - Membership ownership rules.
3. **Sync on the claims payload:**
   - `toClaims` for Azure and Google.
   - Rewire the workflow to the shared mapping code.
4. **JIT enrichment:** `fetchUserGroups` in the OIDC callback.
5. **Scheduler and status:** sync state, locking, backoff, "Sync now", status API.
6. **UI and docs.**
7. **Deprovisioning safeguards:** circuit breaker, then enabled by default only if approved.

## Open questions

- **Role ownership:** do we track it per role (`userOrgRoles.source`), or recompute the whole role set from the active methods?
- **Existing Azure IdPs with `identifierPath = "sub"`:** block sync, migrate them to `oid` (which changes every username), or match by email once?
- **Global IdPs:** do the JIT and sync defaults (`defaultOrgMapping` / `defaultRoleMapping`) also get split, or do they stay shared?
