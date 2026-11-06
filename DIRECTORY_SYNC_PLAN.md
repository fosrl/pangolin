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

| Method                 | When it runs                   | Needs the API integration            |
| ---------------------- | ------------------------------ | ------------------------------------ |
| **Manual** (default)   | An admin pre-provisions users  | No                                   |
| **Just in time (JIT)** | At login, in the OIDC callback | No, but it uses the API when enabled |
| **Sync**               | Background job on an interval  | Yes                                  |

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
  1. `identifierPath` gives `users.username`, the key that links the directory user to a Pangolin account. It should point to the provider's immutable ID (`oid` / `sub`).
  2. The org mapping decides whether the user is in the org.
  3. The role mapping decides the roles.

  Because the path and the mappings are the same JMESPath that login runs, a synced user and the same person logging in end up on the same account (`(idpId, username)`).

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

| Claim                | Graph source                            | Matches the token?                                                                                                                                                        |
| -------------------- | --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `oid`                | `id`                                    | ✅ Same value                                                                                                                                                              |
| `tid`                | tenant ID                               | ✅                                                                                                                                                                         |
| `name`               | `displayName`                           | ✅                                                                                                                                                                         |
| `email`              | `mail`, falling back to `otherMails[0]` | ⚠️ Usually. The token claim is optional.                                                                                                                                   |
| `preferred_username` | `userPrincipalName`                     | ⚠️ Matches for members. For guests, the token has the real email, but Graph has `user_domain#EXT#@tenant.onmicrosoft.com`.                                                 |
| `groups`             | transitive group **object IDs**         | ✅ Same format: the token's `groups` claim also holds object IDs, not names. It's optional in the token (only present when the app emits it), but sync always includes it. |
| `sub`                | —                                       | ❌ Can't be built: it's a pairwise ID per app                                                                                                                              |
| `wids`               | —                                       | Not included. It's optional in the token and holds directory role template IDs, which aren't useful for mappings.                                                         |
| `idp`                | —                                       | Not included. It's only present for guest accounts.                                                                                                                       |

Extra field outside the token: `groupNames` (display names). This lets the mapping builder match on names while `groups` stays token-compatible.

**Identifiers:** an Azure IdP using sync must have an `identifierPath` that resolves from the payload. `oid` is the default for new Azure IdPs; `sub` is refused when sync is enabled.

### Google (Admin SDK Directory API)

Verified: the token's `sub` equals the Directory user `id`, so `sub` is the external ID. `sub` is also the same across OAuth clients (unlike Entra's `sub`).

| Claim                        | Directory source                     | Matches the token?                                                           |
| ---------------------------- | ------------------------------------ | ---------------------------------------------------------------------------- |
| `sub`                        | `id`                                 | ✅ Same value                                                                 |
| `email`                      | `primaryEmail`                       | ✅                                                                            |
| `email_verified`             | always `true`                        | ✅                                                                            |
| `name`                       | `name.fullName`                      | ✅                                                                            |
| `given_name` / `family_name` | `name.givenName` / `name.familyName` | ✅                                                                            |
| `hd`                         | the primary email's domain           | ✅ The token only has it for Workspace accounts, and every synced user is one |
| `picture`                    | —                                    | Not included. The Directory `thumbnailPhotoUrl` is a different URL.          |
| `groups`                     | transitive group emails              | — Not in the token. Same shape that JIT injects.                             |

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

- `apiIntegrationEnabled`: new, default `false`. Existing rows with `directorySyncEnabled = true` get `true`.
- `directorySyncConfig`: kept (the encrypted provider credentials).
- `allowManualProvisioning`: new, default `true`.
- `autoProvision`: kept as is in the DB and API, and it means JIT. Only the UI may label it "Just in time".
- `directorySyncEnabled`: now means "sync on". Requires the API integration.
- Remove the `autoProvision` ⟂ `directorySyncEnabled` exclusivity check in the global and org IdP create/update routes.
- `defaultOrgMapping` / `defaultRoleMapping` become separate JIT and sync variants for global IdPs.

**`idpOrg`**

- `orgMapping` / `roleMapping`: kept as is, they're the JIT mappings.
- `syncOrgMapping`: new.
- `syncRoleMapping`: replaces `directoryRoleMapping` (which only existed on this branch).
- `mappingsLinked`: new boolean, default `true`. It's the UI's "one editor" state.
- Both role mappings use the existing JIT format from [idpRoleMapping.ts](src/lib/idpRoleMapping.ts): a string that always evaluates as JMESPath. Fixed roles are stored as `'Role'` / `['A', 'B']`, and the builder as a JMESPath string with the `__PANGOLIN_ROLE_MAP_BUILDER_V1__` metadata prefix. The JSON format from `idpDirectorySyncRoleMapping.ts` goes away.
- "Create missing roles" can't live inside a JMESPath string. Where it's stored is **to decide** (see [Open questions](#open-questions)).
- The migration copies the existing `orgMapping` / `roleMapping` into `syncOrgMapping` / `syncRoleMapping`.
- `directorySyncDeletions`: kept, scoped to sync.

**`idpOidcConfig`**

- `identifierPath`: unchanged in the DB, API and UI. It gives `users.username`, which login and sync match on (unique on `(idpId, username)`). The UI defaults it to the provider's immutable ID: `oid` for `azure`, `sub` for `google` and `oidc`. No separate external ID column.

**Sync state.** `idpSyncState` and `idpSyncUser` were dropped (migration 0031) and stay dropped: no run state is stored. Every run is a full sync, and failures are only logged.

## Sync engine

The current code lives in [server/private/lib/directorySync/](server/private/lib/directorySync/).

**Providers** ([azure.ts](server/private/lib/directorySync/azure.ts), [google.ts](server/private/lib/directorySync/google.ts))

- They keep returning the neutral `DirectoryUser` from [types.ts](server/private/lib/directorySync/types.ts).
- New per-provider function: `toClaims(user)`, which builds the sync claims payload.
- New per-provider function: `fetchUserGroups(externalId)`, used by JIT enrichment.

**Workflow** ([syncWorkflow.ts](server/private/lib/directorySync/syncWorkflow.ts))

Today the workflow sets `username` straight from the email and resolves roles with its own modes. It changes to:

1. Build the claims.
2. Apply `identifierPath` (username, the account match).
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

- A plain `setInterval` on a fixed sync interval (one constant in code) syncs every IdP with sync enabled, one after another.
- A failure is logged and that IdP is retried on the next interval. No locks, backoff or stored status.

## API and UI

**IdP settings**

- "API integration" section: a toggle plus the provider fields.
- "User provisioning" section: three toggles for Manual, JIT and Sync.
- Mappings section:
  - Org mapping.
  - Role mapping, with the builder as the default.
  - "Create missing roles".
  - "Configure JIT and sync separately" toggle.
- "Sync now" button.

**Create user page / API**
i
- Filter out IdPs with `allowManualProvisioning = false`.

**Endpoints**

- `POST /idp/:idpId/sync` ("Sync now", with a dry-run option).

**Docs**

- The claims payload per provider (the tables above).
- Setup: Azure application permissions plus admin consent; Google domain-wide delegation scopes.

## Implementation steps

Each step can ship on its own.

1. ✅ **Schema** (pg and sqlite; the migration is generated by hand).
   - `idp`: add `allowManualProvisioning` and `apiIntegrationEnabled`.
   - `idpOrg`:
     - Keep `orgMapping` / `roleMapping` as the JIT mappings.
     - Rename `directoryRoleMapping` to `syncRoleMapping`.
     - Add `syncOrgMapping` and `mappingsLinked`.
   - Data copies in the migration:
     - `apiIntegrationEnabled = directorySyncEnabled`
     - `syncOrgMapping = orgMapping`
   - Copying `roleMapping` into `syncRoleMapping` is deferred, along with the rest of the data migration.
   - Note for the deferred data migration (runs on **production** data):
     - `0032_red_devos.sql` doesn't run the two data copies above yet.
     - Rows where the JIT and sync mappings differ after the copy need `mappingsLinked = false`, or the single editor overwrites one of them.
     - The new unique index on `user (idpId, username)` fails if production has duplicate usernames within one IdP; dedupe first.
2. **Unified role-mapping format.** Sync stores and evaluates its role mapping exactly like JIT: a string read as JMESPath, using the format from [idpRoleMapping.ts](src/lib/idpRoleMapping.ts) (fixed roles and the builder both compile to JMESPath). The JIT side and `idp.defaultRoleMapping` don't change.
   - **Shared evaluation** ([evaluateRoleMapping.ts](server/lib/idp/evaluateRoleMapping.ts), server-side so `jmespath` stays out of the client bundle):
     - [x] Move `normalizeRoleMappingResult` out of [validateOidcCallback.ts](server/routers/idp/validateOidcCallback.ts) into [evaluateRoleMapping.ts](server/lib/idp/evaluateRoleMapping.ts).
     - [x] Add `evaluateRoleMapping(stored, claims): string[]`: `unwrapRoleMapping` → `jmespath.search` → `normalizeRoleMappingResult`.
     - [x] Make JIT call it. Login behavior must stay the same.
   - **Create missing roles:** deferred (see [Open questions](#open-questions)). In this step, sync only assigns roles that already exist in the org, like JIT.
   - **Sync engine** ([syncWorkflow.ts](server/private/lib/idpAPI/syncWorkflow.ts), [types.ts](server/private/lib/idpAPI/types.ts)):
     - [x] Change `roleMapping` in `types.ts` from `DirectorySyncRoleMappingConfig` to the stored string.
     - [x] Rewrite `resolveUserRoles`. Evaluate the claims from `provider.toClaims(user)` (they already carry `groups` and `groupNames`) with `evaluateRoleMapping`, then look up roles by name.
     - [x] Remove the role-creation branch for now. Keep the dry-run handling.
     - [x] Drop the `parseDirectorySyncRoleMapping` call and the `fixedRoles / groupMapping / automatic` switch.
   - **API:**
     - [x] [createOrgOidcIdp.ts](server/private/routers/orgIdp/createOrgOidcIdp.ts) / [updateOrgOidcIdp.ts](server/private/routers/orgIdp/updateOrgOidcIdp.ts): `syncRoleMapping` takes the same string as `roleMapping` (already `z.string()`, no change needed).
   - **Verify:**
     - [x] Unit-test `evaluateRoleMapping` on `'Member'`, `['A','B']`, the builder prefix, a raw expression and null.
     - [ ] JIT login gives the same roles as before.
     - [x] Sync dry run with a fixed mapping, a builder mapping and a raw expression.
     - [x] `tsc` + `eslint`.
3. ✅ **Role-mapping UI for sync.** Ships with step 2.
   - [x] [DirectorySyncConfigWidget.tsx](src/components/DirectorySyncConfigWidget.tsx): use [RoleMappingConfigFields.tsx](src/components/RoleMappingConfigFields.tsx), the same editor as JIT.
   - [x] Org IdP [create/page.tsx](<src/app/[orgId]/settings/(private)/idp/create/page.tsx>) and [general/page.tsx](<src/app/[orgId]/settings/(private)/idp/[idpId]/general/page.tsx>): load `syncRoleMapping` with `detectRoleMappingConfig` and save it with `compileRoleMappingExpression`, like `roleMapping`.
   - [x] Sync builder default `claimPath`: `groupNames` (`defaultSyncRoleMappingConfig` in [idpRoleMapping.ts](src/lib/idpRoleMapping.ts)), since `groups` holds provider group IDs.
   - [x] Delete [idpDirectorySyncRoleMapping.ts](src/lib/idpDirectorySyncRoleMapping.ts) and [DirectorySyncRoleMappingFields.tsx](src/components/DirectorySyncRoleMappingFields.tsx).
   - [x] i18n: remove the `directorySyncRoleMapping*` keys that are no longer used from `messages/en-US.json`.
4. ✅ **Immutable ID as the username.** Login and sync link accounts on `(idpId, username)`, where the username comes from `identifierPath`; pointing it at the provider's immutable ID keeps accounts stable when emails change.
   - No `externalIdPath` / `users.externalUserId`: the external ID is stored in `users.username`. Unique index `idx_user_idpId_username` on `(idpId, username)` (pg + sqlite schemas; the migration is generated locally).
   - Login ([validateOidcCallback.ts](server/routers/idp/validateOidcCallback.ts)): matches on `(idpId, username)`; the insert is an upsert on that index so it can't race sync.
   - Sync ([syncWorkflow.ts](server/private/lib/idpAPI/syncWorkflow.ts)): the username comes from the claims through `identifierPath`, lowercased like login; the insert is an upsert on the same index.
   - UI: the field stays "Identifier Path". The create forms default it per provider ([oidcIdpProviderDefaults.ts](src/lib/idp/oidcIdpProviderDefaults.ts)): `oid` for Azure, `sub` for Google and OIDC.
5. **Shared mapping code.**
   - Move the org/role evaluation and the apply step out of [validateOidcCallback.ts](server/routers/idp/validateOidcCallback.ts) into shared functions, such as:
     - `resolveOrgMemberships(claims, idpOrgs, method)`
     - `applyMemberships(...)`
   - "Create missing roles" lives in the shared code.
   - Login behavior stays exactly the same.
6. **Membership ownership.**
   - Each method only adds, re-roles or removes the `userOrgs` rows it owns:
     - `autoProvisioned` marks JIT rows.
     - `directorySynched` marks sync rows.
     - Rows with neither flag (manual) are never touched.
   - Decide role ownership (open question), then implement it.
   - ✅ Remove the `autoProvision` ⟂ `directorySyncEnabled` check from the org IdP create/update routes; sync requires `apiIntegrationEnabled` instead (done with the step 11 UI). Until the ownership rules land, JIT and sync both on can flip a user's roles.
7. **Manual provisioning switch.** The org IdP create/update APIs already accept `allowManualProvisioning` (done with the step 11 UI).
   - Expose `allowManualProvisioning` in the IdP create/update APIs.
   - When it's `false`, hide the IdP on the create-user page and reject it in the create-user API.
8. **Sync builds token-like claims.**
   - Add `toClaims(user)` to [azure.ts](server/private/lib/directorySync/azure.ts) and [google.ts](server/private/lib/directorySync/google.ts), following the [claims tables](#sync-claims-payload).
   - Rewire [syncWorkflow.ts](server/private/lib/directorySync/syncWorkflow.ts) to run: claims → `identifierPath` → `syncOrgMapping` → `syncRoleMapping` → `applyMemberships`.
   - ✅ Stop setting `username` to the email (done in step 4).
   - Refuse sync when an Azure IdP's `identifierPath` is `sub`.
   - Stop selecting only IdPs with `autoProvision = false`.
9. **JIT fetches groups.**
   - Add `fetchUserGroups(externalId)` to each provider. It must share the group expansion code with sync.
   - Call it in the OIDC callback when `apiIntegrationEnabled` is on.
   - Add the result to the claims as `groups` / `groupNames`.
   - If the call fails, log a warning and continue with the token claims.
10. **Scheduler.**
   - A `setInterval` in the private `startSchedulers`, on a fixed sync interval, that syncs each sync-enabled IdP in turn and logs failures.
   - Endpoint: `POST /idp/:idpId/sync` (with dry run).
11. **UI** (global and org IdP pages).
   - ✅ "API integration" section (org IdPs, google/azure): a toggle plus the provider fields ([ApiIntegrationConfigWidget.tsx](src/components/ApiIntegrationConfigWidget.tsx)). Turning it off turns sync off.
   - ✅ "User provisioning" section (org IdPs): Manual, JIT (`autoProvision`) and Sync toggles, not mutually exclusive. Sync is disabled until the API integration is on.
   - Global IdP pages: no API integration (credentials only live on org IdPs); the Manual toggle needs `allowManualProvisioning` in the global routes first.
   - Mappings ([IdpUserProvisioningFields.tsx](src/components/IdpUserProvisioningFields.tsx), [IdpMappingTabs.tsx](src/components/IdpMappingTabs.tsx)):
     - ✅ Org mapping and role mapping tabs, shown when JIT or sync is on.
     - ✅ "Configure JIT and sync separately", backed by `mappingsLinked` (on by default: one editor, saved to both the JIT and sync columns). Unlinking starts the sync mappings from the shared ones and shows one editor per enabled method. The org IdP APIs accept `syncOrgMapping` and `mappingsLinked`.
     - Role mapping, with the builder as the default.
     - "Create missing roles".
   - "Sync now" button.
12. **Docs and safeguards.**
    - Document the claims payload for each provider.
    - Setup guides: Azure application permissions plus admin consent; Google domain-wide delegation scopes.
    - Deprovisioning safeguards:
      - Circuit breaker on mass removals.
      - Never deprovision after a partial or failed fetch.
      - Removals turn on by default only if approved.

## Open questions

- **Role ownership:** do we track it per role (`userOrgRoles.source`), or recompute the whole role set from the active methods?
- **Existing IdPs' `identifierPath`:** IdPs created with `email` keep it (changing it remaps every user). Do we offer a migration to `oid` / `sub`, which needs the users' usernames rewritten?
- **Create missing roles:** where is it stored (one column per method on `idpOrg`, a global IdP default too?), and when does JIT start honoring it?
- **Global IdPs:** do the JIT and sync defaults (`defaultOrgMapping` / `defaultRoleMapping`) also get split, or do they stay shared?
