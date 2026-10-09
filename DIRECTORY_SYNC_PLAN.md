# Plan: IdP directory sync (Microsoft Entra ID and Google Workspace)

## What already exists

- `idp.directorySyncEnabled` exists. It is mutually exclusive with `autoProvision` (see [decision #2](#2-sync-replaces-auto-provisioning-and-owns-org-and-role-mapping)) and only allowed when the variant is `google` or `azure`.
  - Global IdPs: [createOidcIdp.ts](server/routers/idp/createOidcIdp.ts), [updateOidcIdp.ts](server/routers/idp/updateOidcIdp.ts).
  - Org IdPs: [createOrgOidcIdp.ts](server/private/routers/orgIdp/createOrgOidcIdp.ts), [updateOrgOidcIdp.ts](server/private/routers/orgIdp/updateOrgOidcIdp.ts).
  - Create and update return `400` if both would be on. In the UI, only the org IdP pages expose the toggle (exclusive with auto provisioning). The global admin IdP pages don't show it for now.
- A first Azure sync prototype exists in [directorySync/azure.ts](server/private/lib/directorySync/azure.ts). It refuses to run when `autoProvision` is on. [idpDirectorySync.ts](server/routers/idp/idpDirectorySync.ts) is empty.
- Provisioning only happens at login, in [validateOidcCallback.ts](server/routers/idp/validateOidcCallback.ts):
  - `users.username` = JMESPath(`identifierPath`) applied to the ID token claims.
  - Org and role mappings are JMESPath expressions over those same claims.
  - It only ever removes `userOrgs` rows where `autoProvisioned = true`.
- The Azure tenant ID isn't stored as its own field. The UI re-parses it from `authUrl` ([general/page.tsx](src/app/admin/idp/[idpId]/general/page.tsx)).
- Building blocks for a scheduler:
  - [server/startSchedulers.ts](server/startSchedulers.ts) and [server/private/startSchedulers.ts](server/private/startSchedulers.ts) start the existing background jobs.
  - [LockManager](server/private/lib/lock.ts) provides a Redis-backed lock that falls back to a local lock, so jobs work with multiple instances.

## Goals and non-goals

**Goals**

- Create and update users in Pangolin without waiting for them to log in.
- Deactivating or removing users who left the directory is **not confirmed yet** (see [Deprovisioning](#4-deprovisioning-not-confirmed)).
- Keep org and role assignments current from group membership.
- Map directory groups to org roles with an explicit sync-only mapping.

**Non-goals (v1)**

- SCIM push.
- Webhooks or push notifications.
- Generic OIDC providers.
- Two-way sync.

## Provider study

|                  | Microsoft Entra (done)                                                           | Google Workspace (to study)                                                                                                                                                            |
| ---------------- | -------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| API              | Microsoft Graph                                                                  | Admin SDK Directory API (`admin.googleapis.com/admin/directory/v1`)                                                                                                                    |
| Users            | `GET /users`, 999 per page                                                       | `users.list?customer=my_customer`, 500 per page                                                                                                                                        |
| Groups / members | `/groups`, `/groups/{id}/members` or `/transitiveMembers`                        | `groups.list` (200 per page), `members.list?includeDerivedMembership=true`                                                                                                             |
| Incremental      | ✅ `/users/delta` and `/groups/delta` (with `members@delta`)                      | ❌ No delta API: full snapshot every run, then diff on our side                                                                                                                         |
| App-only auth    | Client credentials using the **existing** clientId and secret, plus tenant       | **Service account + domain-wide delegation** impersonating an admin, so **new credentials**: SA JSON key and admin email                                                               |
| Permissions      | `User.Read.All` and `GroupMember.Read.All` (application), plus **admin consent** | Scopes `admin.directory.user.readonly`, `admin.directory.group.readonly` and `admin.directory.group.member.readonly`, authorized in the Admin console under **Domain-wide delegation** |
| Throttling       | Per app per tenant, `429` + `Retry-After`                                        | Per project quota (believed to be about 2,400 queries/min, to verify), `403 rateLimitExceeded` / `429`, exponential backoff                                                            |
| Disabled users   | `accountEnabled = false`                                                         | `suspended`, `archived`                                                                                                                                                                |
| Stable user ID   | `id` (= `oid` claim)                                                             | `id` (= `sub` claim)                                                                                                                                                                   |

### Request counts per sync (Entra)

With N users, G groups, and up to 999 items per page:

- Full sync (per group): `ceil(N/999) + ceil(G/999) + Σ ceil(members_g / 999)` ≈ `N/999 + G`. For example, 5,000 users and 200 groups ≈ 206 requests.
- Per user (`/users/{id}/memberOf` for every user): `ceil(N/999) + N`. Avoid this approach.
- Delta sync with no changes: 2 requests (users delta + groups delta).
- `$expand=memberOf` cuts off at about 20 groups per user. Don't rely on it.

### Google items to verify

1. That the Google ID token's `sub` really equals the Directory `user.id`. This is believed true, but the matching logic depends on it.
2. Whether to support a second auth option: admin OAuth consent with an offline refresh token and the extra directory scopes on the existing OAuth client. Setup is easier, but sync stops working if that admin leaves.
3. Real quota numbers and how errors look. The Directory API often returns `403` with `reason: rateLimitExceeded` rather than `429`.
4. Group identifiers: group email vs `id`, and which one is friendlier in role mappings.
5. Whether `includeDerivedMembership` is enough for nested groups, or whether we need the Cloud Identity `searchTransitiveGroups` API.
6. The library choice: `google-auth-library`, or signing the JWT-bearer assertion ourselves. Neither `jose` nor any Google or Azure SDK is a dependency today.

## How other products do it

- **NetBird:** syncs users and groups. Synced groups play the part that roles play in Pangolin: access controls are set per group.
- **defguard:** works the same way.
- Neither relies much on the IdP's own roles (Entra app roles, Google admin roles). Groups are what gets synced and used.

**What this means for Pangolin:**

- **Org IdPs** (one IdP per org): an IdP group can map one-to-one to a Pangolin role in that org, like NetBird and defguard do.
- **Global IdPs** (one IdP shared by several orgs): it's harder. A group has to resolve to an org *and* a role, so a direct group → role mapping isn't enough. Either keep the existing JMESPath org and role mappings, or add a mapping that is scoped per org.

## Key design decisions

### 1. Matching synced users to users who log in (biggest risk)

Synced users must get the same `username` that login computes with `identifierPath`.

- **Azure:** the default `identifierPath` is `sub`. Entra's `sub` is **unique per app and is not the Graph user ID**, so a synced user can't be linked to a logged-in one. Options:
  - require `oid` as the identifier when sync is on, or
  - map Graph `id` to `oid` and refuse to enable sync if `identifierPath` isn't `oid`, or
  - fall back to matching by email.

  Existing Azure IdPs that use `sub` need a migration story.
- **Google:** `sub` = Directory `id`, so the default works (pending verification item 1).

### 2. Sync replaces auto provisioning and owns org and role mapping

An IdP uses **either** auto provisioning (claim-based JMESPath mappings, applied at login) **or** directory sync (group mapping, applied by the sync job), never both. The two use different role mappings, so running both would make them fight over the same memberships.

Directory API responses (Graph `user`, Directory `user`) don't look like ID token claims. Faking claims only matches login for a few fields (`oid`, `name`, `upn`, `groups`), and silently diverges for the rest (`sub` is per-app in Entra, `email` is optional, `roles` and custom claims don't exist in Graph). So sync doesn't run the login org/role mappings.

- **Identifier:** fixed rule, not configurable. It must produce the same `users.username` login computes, so sync only runs when `identifierPath` resolves from directory data. Azure: `oid` → Graph `id`, `preferred_username`/`upn` → `userPrincipalName`; `sub` is refused. Google: `sub` → Directory `id`.
- **Email / name:** read directly from directory fields (Azure `mail` / `displayName`).
- **Orgs and roles:** an explicit table `idpGroupMapping (idpId, externalGroupId, orgId, roleId)`. A user gets every role mapped to a group they're a (transitive) member of; an org membership exists wherever they have at least one role. Without full RBAC, only the first mapped role per org is kept.
- Only mapped groups are fetched, which also bounds the request count.
- The admin UI can list directory groups so admins pick from a list instead of pasting IDs. Same model works for Google, where tokens carry no groups at all.

**Login when sync is on.** Since `autoProvision` is off, login takes the non-provisioning branch of [validateOidcCallback.ts](server/routers/idp/validateOidcCallback.ts):

- It only authenticates. It doesn't create users or touch orgs, roles or profile fields.
- A user who hasn't been synced yet, or has no org membership, is refused with "unprovisioned". Admins can run "Sync now" to fix this.
- Sync is the only writer for users, memberships and roles of that IdP. That includes email and name updates, since login no longer updates them.

### 3. Shared write path (optional refactor)

Login and sync no longer run on the same IdP, so sharing code isn't needed for correctness. It's still worth pulling the "apply" half of the provisioning block out of `validateOidcCallback.ts` into a shared function, for example `applyUserMemberships(trx, idp, user, desired: { orgId, roleIds }[])`: upsert the user, add orgs, re-sync roles on `autoProvisioned` orgs. Login computes `desired` from claims, sync from `idpGroupMapping`. Sync writes memberships with `autoProvisioned = true`, so the existing rule that only those rows are ever changed or removed still holds.

### 4. Deprovisioning (not confirmed)

> ⚠️ Removing or deactivating users during sync has **not been approved**. It's risky: a bad credential, a wrong group filter, a partial API response or a bug in the diff could lock a whole org out at once. Until a decision is made, sync **must not delete, disable or remove anything**.

**Until a decision is made (v1 default):**

- Sync only creates and updates users, memberships and roles.
- Users who are missing from the directory, disabled or suspended are only **detected and reported**: logged, counted in the sync run, and possibly listed in the UI as "would be removed". Nothing changes for them in Pangolin.

**If deprovisioning is approved later, it needs safeguards:**

- An explicit per-IdP opt-in, off by default.
- It only ever touches `autoProvisioned` memberships. Manually added memberships (`autoProvisioned = false`) are never touched, which matches what login does today.
- Prefer disabling over deleting, with a grace period, for example only acting after a user has been missing for N consecutive syncs.
- A circuit breaker: abort the run if more than X% of the IdP's users, or more than N users, would be removed.
- Never deprovision after an incomplete or failed fetch. That covers a page error mid-run, a throttled run, or an empty response.
- A dry-run mode that shows what would be removed before turning it on.

**Questions to answer before approving:**

- Delete the `users` row, disable it, or only remove `autoProvisioned` org memberships?
- Revoke sessions right away?
- What counts as "gone": deleted only, or also disabled/suspended/archived, or also removed from the synced groups?

### 5. Sync scope

Add an optional filter for which groups to sync, or only sync users assigned to the app (Azure: `appRoleAssignedTo`). This keeps request counts down for large tenants.

## Data model (pg and sqlite schemas, plus a migration)

- **`idpDirectorySyncConfig`**: provider-specific credentials and options.
  - Google: SA client email, private key (encrypted), admin email to impersonate, customer ID.
  - Both: group filter.
  - Azure: an explicit `tenantId` column, instead of parsing `authUrl`.
- **`idpGroupMapping`**: `idpId`, `externalGroupId`, `orgId`, `roleId`. Sync-only org/role mapping (see decision #2).
- **`idpSyncState`**: one row per IdP. Columns: `usersDeltaLink`, `groupsDeltaLink`, `status`, `lastSyncStartedAt`, `lastSyncSucceededAt`, `lastError`, `consecutiveFailures`, `nextSyncAt`.
- **`idpSyncRun`**: optional run history with counts, request count and error. Old rows are pruned.

Individual Graph or Directory requests and retries are logged, not stored in the DB. Access tokens are cached in memory (or Redis), never stored in the DB.

## Sync engine

```
server/(private/)lib/directorySync/
  providers/azure.ts     // token, paging, delta, 429 handling
  providers/google.ts    // JWT-bearer token, paging, full snapshot
  types.ts               // DirectoryProvider interface
  runSync.ts             // group mapping resolution, diff, apply
  scheduler.ts
```

- **Provider interface.** Each provider returns either:
  - `{ kind: "delta", changedUsers, removedUserIds, membershipChanges, nextState }` (Azure), or
  - `{ kind: "snapshot", users, groups, memberships }` (Google, and Azure's first run).

  For a snapshot, the core diffs against the users Pangolin already has for that IdP. Users who are missing, plus Azure `@removed` entries, are only reported for now; see [Deprovisioning](#4-deprovisioning-not-confirmed).
- **Scheduler.**
  - A tick runs every minute and selects IdPs where `directorySyncEnabled` is set and `nextSyncAt <= now`.
  - It takes the `idp-sync:{idpId}` lock, caps how many IdPs sync at once, and staggers `nextSyncAt`.
  - Default interval: 15 to 60 minutes, possibly configurable per IdP.
- **Failure handling.**
  - A short `Retry-After` → sleep in memory and retry the same page.
  - A long `Retry-After`, or repeated failures → stop the run, set `nextSyncAt`, and don't save delta links. The backoff is `nextSyncAt = now + min(interval * 2^consecutiveFailures, 24h)`, reset on success.
  - `410` / `syncStateNotFound` → clear the delta links and do a full sync.
- Save the new delta links only after the whole run succeeds.
- Access tokens are cached in memory until shortly before they expire.

## API and UI

- `POST /idp/:idpId/sync`: "Sync now".
- `GET /idp/:idpId/sync-status`: last sync time, status, error, counts.
- The IdP settings page gets:
  - Google service account fields.
  - Azure tenant ID as a stored field.
  - A sync status card.
  - Setup instructions: Azure application permissions plus admin consent; Google DWD scopes.
- Clear errors for the usual failures: `403` → "admin consent missing" or "DWD not authorized"; `401` → "bad secret or key".

## Phases

1. **Study:** finish the Google verification items above. Confirm `oid` vs `sub` behavior on a test Entra tenant.
2. **Refactor (optional):** extract `applyUserMemberships` from the OIDC callback, with no change in behavior. Add tests.
3. **Schema:** add the sync config and state tables and migrations, and store Azure `tenantId` explicitly.
4. **Azure provider:** full sync, then delta.
5. **Scheduler:** locking, backoff, status API, "Sync now".
6. **Google provider:** snapshot plus diff.
7. **UI and docs:** credentials, status card, setup guides.
8. **Deprovisioning, only if approved:** opt-in setting, dry run, grace period, circuit breaker.

## Open questions

- Is this an enterprise/licensed feature? If so, the engine belongs in `server/private`. The flag currently sits on the shared `idp` table and routes.
- **Blocking for deprovisioning:** should sync remove or disable users at all? See the questions in [Deprovisioning](#4-deprovisioning-not-confirmed).
- How to handle existing Azure IdPs with `identifierPath = "sub"`: block sync, migrate them, or match by email?
- Which group identifiers to expose in mappings for Google: emails or IDs?
- Org IdPs ([server/private/routers/orgIdp](server/private/routers/orgIdp)) can already store the flag. For them, should `idpGroupMapping` be limited to the IdP's own org? Org IdPs fit the group = role model most easily (see [How other products do it](#how-other-products-do-it)).
- For global IdPs, how should a synced group resolve to an org and a role? Keep the JMESPath mappings, or add per-org group → role mappings?
- Global sync interval, or configurable per IdP?

## References

**Microsoft Graph / Entra**

- List users: https://learn.microsoft.com/en-us/graph/api/user-list
- User delta: https://learn.microsoft.com/en-us/graph/api/user-delta
- Delta query overview: https://learn.microsoft.com/en-us/graph/delta-query-overview
- Group delta: https://learn.microsoft.com/en-us/graph/api/group-delta
- Group members: https://learn.microsoft.com/en-us/graph/api/group-list-members
- Transitive members: https://learn.microsoft.com/en-us/graph/api/group-list-transitivemembers
- App role assignments: https://learn.microsoft.com/en-us/graph/api/serviceprincipal-list-approleassignedto
- Client credentials flow: https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-client-creds-grant-flow
- Permissions reference: https://learn.microsoft.com/en-us/graph/permissions-reference
- Admin consent: https://learn.microsoft.com/en-us/entra/identity/enterprise-apps/grant-admin-consent
- Paging: https://learn.microsoft.com/en-us/graph/paging
- Throttling: https://learn.microsoft.com/en-us/graph/throttling
- Throttling limits per service: https://learn.microsoft.com/en-us/graph/throttling-limits
- National clouds: https://learn.microsoft.com/en-us/graph/deployments

**Google Workspace (to fill in during the study)**

- Admin SDK Directory API: https://developers.google.com/admin-sdk/directory
- Domain-wide delegation: https://developers.google.com/workspace/guides/create-credentials#optional_set_up_domain-wide_delegation_for_a_service_account
