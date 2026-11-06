# Plan: IdP API integration (JIT enrichment + directory sync)

This plan only covers **Microsoft Entra ID** (`azure`) and **Google Workspace** (`google`). Plain OIDC providers (`oidc`) don't get any of this.

## Words used in this plan

- **IdP (identity provider):** the service users log in with, like Azure or Google.
- **Claims:** the JSON object that describes a user after login, for example `{ "sub": "123", "email": "alice@acme.com", "groups": [...] }`. It comes from the ID token the IdP sends us.
- **JMESPath:** a small query language for JSON. `email` returns the `email` field, `contains(groups, 'admins')` returns `true` or `false`. We use it to read values out of the claims.
- **Provisioning:** creating a Pangolin user and adding them to an org. **Deprovisioning** is removing them.
- **JIT (just in time):** provisioning at login. The user logs in, and we create their account on the spot. In the DB this is the `autoProvision` flag.
- **Sync (directory sync):** a background job that reads *all* users from the IdP's API and provisions them, even if they have never logged in.
- **API integration:** credentials that let Pangolin call the IdP's API (Microsoft Graph or the Google Admin SDK). JIT works without it, sync needs it.
- **Mapping:** a rule that turns claims into a decision. The **org mapping** decides *if* the user joins the org. The **role mapping** decides *which roles* they get.
- **Membership row:** one row in `userOrgs` = one user in one org. Their roles are in `userOrgRoles`.
- **`idp` / `idpOrg` / `idpOidcConfig`:** DB tables. `idp` is the provider, `idpOrg` holds the mappings for one org, `idpOidcConfig` holds the OIDC settings (client ID, `identifierPath`, …).

## How an admin sets it up

An admin configures an IdP in three steps.

### 1. Turn on the API integration

This gives Pangolin a way to call the IdP's API. On its own, it doesn't create any users. It just makes the API available to JIT and sync.

What the admin enters:

- **Google:** a service account JSON key. Optionally, an admin email to impersonate and a customer ID.
- **Azure:** nothing new. We reuse the OIDC client ID and secret. The tenant ID is read from `authUrl` for now.

These are stored encrypted in `idp.directorySyncConfig` ([idpDirectorySyncConfig.ts](src/lib/idpDirectorySyncConfig.ts), [config.ts](server/private/lib/idpAPI/config.ts)).

### 2. Choose how users get created

The admin can turn on any mix of these three:

| Method                 | When it runs                    | Needs the API integration?             |
| ---------------------- | ------------------------------- | -------------------------------------- |
| **Manual** (default)   | An admin adds the user by hand  | No                                     |
| **Just in time (JIT)** | When the user logs in           | No, but it uses the API if it's on     |
| **Sync**               | In the background, every N min  | Yes                                    |

**Manual**

- If manual is off, the IdP doesn't show up on the "create user" page, and the create-user API refuses it.

**JIT**

- If the API integration is on, at login we also ask the API for the user's groups and add them to the claims as `groups` (and `groupNames`). Then the mappings run.
- Why we need this:
  - Google's ID token never contains groups. Without the API, JIT can't map groups to roles on Google.
  - Azure's token drops the `groups` list when a user is in more than 200 groups, and some Azure apps aren't set up to send groups at all.
- If the API call fails, we log a warning and keep going with the token's claims. **Login must never break because of the API.**

**Sync**

- Fetches every user from the IdP, with all their groups (including groups inside groups).
- For each user, builds a claims object that looks as much as possible like what that user's ID token would contain (see [What sync puts in the claims](#what-sync-puts-in-the-claims)).
- Then runs the same steps as JIT on it:
  1. `identifierPath` (a JMESPath, e.g. `oid`) gives the username. That's how we know which Pangolin account belongs to which IdP user.
  2. The org mapping decides if the user is in the org.
  3. The role mapping decides their roles.

Because sync and login use the same `identifierPath` and the same kind of mappings, a user created by sync and the same person logging in later end up on **the same account**. Accounts are matched on the pair `(idpId, username)`.

### 3. Set up the mappings

Each method has its own set of mappings: one for JIT, one for sync.

- **By default the admin sees one editor**, and it saves to both the JIT and the sync columns. Most admins want the same rules everywhere, so they only write them once.
- **"Configure JIT and sync separately"** is an advanced toggle that shows two editors. Most people won't need it.

**Org mapping**

- A JMESPath that must return `true`, `false`, or the org's ID.
- It runs before the role mapping. If it says no, the user doesn't join the org.
- `{{orgId}}` in the expression is replaced by the real org ID first.

**Role mapping** has three modes. The builder is the default.

- **Mapping builder:** rules like "group `Engineering` → role `Developer`".
- **Fixed roles:** everyone gets the same roles.
- **JMESPath expression:** write the query yourself.

**Create missing roles** is a separate checkbox. When it's on and the mapping returns a role name the org doesn't have, we create that role instead of ignoring it.

> Example: the mapping returns `["Developer", "Ops"]`, but the org only has `Developer`. With the checkbox off, the user gets `Developer`. With it on, we create `Ops` and the user gets both.

## What sync puts in the claims

At login we get the claims from the ID token. Sync has no token, so it builds the claims itself from the API. We copy the token's field names so that **the same mapping works for both**. Some token fields can't be built from the API; that's fine, they're just missing. Technical token fields (`iss`, `aud`, `exp`, `iat`, …) are never included.

### Azure (Microsoft Graph)

We checked on a test tenant: the token's `oid` is the same value as the Graph user's `id`. So `oid` is the stable ID for Azure users.

| Claim                | Where it comes from in Graph            | Same as in the token?                                                                                                  |
| -------------------- | --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `oid`                | `id`                                    | ✅ Same value                                                                                                           |
| `tid`                | tenant ID                               | ✅                                                                                                                      |
| `name`               | `displayName`                           | ✅                                                                                                                      |
| `email`              | `mail`, or `otherMails[0]` if empty     | ⚠️ Usually. The token doesn't always have it.                                                                           |
| `preferred_username` | `userPrincipalName`                     | ⚠️ Same for normal users. For guests, the token has their real email but Graph has `user_domain#EXT#@tenant.onmicrosoft.com`. |
| `groups`             | group **IDs** (not names)               | ✅ The token also uses group IDs. The token only has it if the app is set up for it; sync always includes it.            |
| `sub`                | —                                       | ❌ Can't be built. Azure gives each app a different `sub` for the same user, and Graph doesn't expose it.               |
| `wids`               | —                                       | Not included. These are admin role IDs, not useful for mappings.                                                       |
| `idp`                | —                                       | Not included. Only guests have it.                                                                                     |

We also add `groupNames` (the groups' display names). It isn't in the token, but it lets admins write rules with readable names (`Engineering`) instead of IDs (`8f3a…`).

**Watch out:** because sync can't build `sub`, an Azure IdP whose `identifierPath` is `sub` can't sync anyone. New Azure IdPs default to `oid`.

### Google (Admin SDK Directory API)

We checked: the token's `sub` is the same value as the Directory user's `id`. Unlike Azure, Google's `sub` is the same for every app, so `sub` is the stable ID for Google users.

| Claim                        | Where it comes from                  | Same as in the token?                                                    |
| ---------------------------- | ------------------------------------ | ------------------------------------------------------------------------ |
| `sub`                        | `id`                                 | ✅ Same value                                                             |
| `email`                      | `primaryEmail`                       | ✅                                                                        |
| `email_verified`             | always `true`                        | ✅                                                                        |
| `name`                       | `name.fullName`                      | ✅                                                                        |
| `given_name` / `family_name` | `name.givenName` / `name.familyName` | ✅                                                                        |
| `hd`                         | the domain of the primary email      | ✅ The token only has it for Workspace accounts, and all synced users are |
| `picture`                    | —                                    | Not included. The API's photo URL is different from the token's.        |
| `groups`                     | group emails                         | Not in the token. Same format JIT adds at login.                         |

Plus `groupNames`, like Azure.

### Rules for both

- A disabled, suspended or archived user gets no orgs, whatever the mappings say.
- JIT and sync get groups from **the same function**, so a mapping can't give different results depending on which one ran.

## When JIT and sync both touch the same user

This is the trickiest part. Both can be on at the same time, and both add, update and remove membership rows. To keep them from fighting, each row remembers who created it:

- `userOrgs.autoProvisioned = true` → JIT created it.
- `userOrgs.directorySynched = true` → sync created it.
- Both `false` → an admin created it by hand.

The rules:

1. A method only updates or removes rows it owns. **Rows an admin created by hand are never touched.**
2. If JIT owns a row and sync also matches that user, sync adds its own flag (and the other way around). The row is only removed when **no** method still wants it.
3. Roles: whenever a method updates a row it owns, it replaces the user's roles with exactly what its role mapping returns. We don't track which method gave which role.
   - With one shared editor (the default), JIT and sync return the same roles, so nothing changes back and forth.
   - If the admin splits the editors and the rules differ, the user's roles switch at every login and every sync run. The UI should warn about this.
   - A role an admin adds by hand to a JIT- or sync-owned row gets removed on the next login or sync run. That's accepted.

## Database changes (pg and sqlite)

**`idp` table**

- `apiIntegrationEnabled`: new, default `false`.
- `directorySyncConfig`: unchanged, holds the encrypted API credentials.
- `allowManualProvisioning`: new, default `true`.
- `autoProvision`: unchanged. It means "JIT is on". Only the UI calls it "Just in time".
- `directorySyncEnabled`: now means "sync is on". It requires `apiIntegrationEnabled`.
- JIT and sync can both be on. The old "only one of the two" check is removed.
- Global IdPs (shared by many orgs) have default mappings used when an org has none of its own: `defaultOrgMapping` / `defaultRoleMapping` for JIT, `defaultSyncOrgMapping` / `defaultSyncRoleMapping` for sync.

**`idpOrg` table** (mappings for one org)

- `orgMapping` / `roleMapping`: unchanged, used by JIT.
- `syncOrgMapping` / `syncRoleMapping`: new, used by sync.
- `mappingsLinked`: new, default `true`. `true` = one shared editor in the UI.
- Role mappings are always stored as a JMESPath string, whatever the mode:
  - Fixed roles: `'Member'` or `['A', 'B']`.
  - Builder: a JMESPath string that starts with `__PANGOLIN_ROLE_MAP_BUILDER_V1__`, so the UI can turn it back into rules ([idpRoleMapping.ts](src/lib/idpRoleMapping.ts)).
- "Create missing roles": `createMissingRoles` (JIT) and `syncCreateMissingRoles` (sync). Global IdPs also have `defaultCreateMissingRoles` / `defaultSyncCreateMissingRoles` on `idp`.
- `directorySyncDeletions`: unchanged. When it's off, sync never removes anyone.

**`idpOidcConfig` table**

- `identifierPath`: unchanged. It's the JMESPath that gives `users.username`. The UI defaults it to the provider's stable ID: `oid` for Azure, `sub` for Google and plain OIDC.
- There's a unique index on `users (idpId, username)`, so one IdP can't have two accounts with the same username.

**No sync history.** We don't store sync runs or their status. Every run re-reads everything, and errors only go to the logs.

## How the code is organized

All sync code is in [server/private/lib/idpAPI/](server/private/lib/idpAPI/).

- **Providers** ([azure.ts](server/private/lib/idpAPI/azure.ts), [google.ts](server/private/lib/idpAPI/google.ts)): one class per IdP. Each one can:
  - list all users with their groups (for sync),
  - `toClaims(user)`: build the claims object from the tables above,
  - `fetchUserGroups(id)`: get one user's groups (for JIT).
- **Sync job** ([syncWorkflow.ts](server/private/lib/idpAPI/syncWorkflow.ts)), for each org:
  1. Build the claims for each user.
  2. Read the username with `identifierPath`.
  3. Run the role mapping. (Org IdPs belong to one org, so sync doesn't run an org mapping for them.)
  4. Compare with what's in the DB and write a **plan**: create user, add to org, update roles, remove from org, or do nothing.
  5. Apply the plan in one DB transaction. In dry-run mode, return the plan without writing anything.
- **Shared with login:** [resolveOrgMembership.ts](server/lib/idp/resolveOrgMembership.ts) runs org mapping → role mapping → look up the roles in the org. Both login ([validateOidcCallback.ts](server/routers/idp/validateOidcCallback.ts)) and sync call it.
- **Removing users (deprovisioning)** must be careful, because a bug here kicks real people out:
  - Only if `directorySyncDeletions` is on.
  - Only rows the method owns.
  - Never after a fetch that failed or only got part of the users. Otherwise a network error would look like "everyone left the company".
  - A **circuit breaker**: if a run would remove a lot of users at once, stop and remove nobody.
- **Scheduler:** a plain `setInterval` that syncs every sync-enabled IdP one after another. If one fails, log it and try again next time. No locks, no retries.

## Screens and endpoints

**IdP settings page**

- "API integration": a toggle plus the provider's fields.
- "User provisioning": three toggles, Manual, JIT and Sync.
- Mappings: org mapping, role mapping (builder by default), "Create missing roles", and "Configure JIT and sync separately".
- A "Sync now" button.

**Create user page and API:** hide and refuse IdPs with `allowManualProvisioning = false`.

**New endpoint:** `POST /idp/:idpId/sync` runs a sync right away. It has a dry-run option.

**Docs to write:** what's in the claims for each provider (the tables above), and setup guides: which Azure API permissions to grant (plus admin consent), and which Google scopes to allow (domain-wide delegation).

## Implementation steps

### Done

1. ✅ **Database columns.** `idp`: `allowManualProvisioning`, `apiIntegrationEnabled`. `idpOrg`: `syncRoleMapping` (renamed from `directoryRoleMapping`), `syncOrgMapping`, `mappingsLinked`. Migrations 0032–0035.
2. ✅ **One role-mapping format.** Sync now stores and runs its role mapping exactly like JIT, through [evaluateRoleMapping.ts](server/lib/idp/evaluateRoleMapping.ts). The old sync-only JSON format is deleted.
3. ✅ **Same role-mapping editor for sync.** Sync uses the JIT editor ([RoleMappingConfigFields.tsx](src/components/RoleMappingConfigFields.tsx)). The builder reads `groupNames` by default, since `groups` holds IDs.
4. ✅ **Stable ID as the username.** Login and sync both find accounts by `(idpId, username)`, with the username from `identifierPath`. Both use an upsert (insert, or update if it already exists), so login and sync can't create the same user twice. New IdPs default to `oid` (Azure) / `sub` (Google, OIDC).
5. ✅ **Shared mapping code.** [resolveOrgMembership.ts](server/lib/idp/resolveOrgMembership.ts) is used by both login and sync.
6. ✅ **Sync builds claims.** `toClaims` exists for Azure and Google, and the sync job uses it. The job picks IdPs with `apiIntegrationEnabled` and `directorySyncEnabled` on, whatever `autoProvision` is.
7. ✅ **JIT fetches groups at login.** Done in [enrichClaimsWithIdpGroups.ts](server/private/lib/idp/enrichClaimsWithIdpGroups.ts). If the API fails, login continues with the token's claims.
8. ✅ **Create missing roles (server side).** Columns, logic in `resolveOrgMembership`, and role creation in `createRoles`. Login and sync both use it. Migrations 0036–0037.
9. ✅ **Sync defaults for global IdPs.** `defaultSyncOrgMapping` / `defaultSyncRoleMapping` in the DB, the global IdP update route and the login callback.
10. ✅ **Org IdP settings page.** API integration section ([ApiIntegrationConfigWidget.tsx](src/components/ApiIntegrationConfigWidget.tsx)), the Manual / JIT / Sync toggles (several can be on), and the mapping tabs with "Configure JIT and sync separately". The org IdP API accepts all the new fields.

### Left to do

1. **Fix: sync touches rows that JIT owns.** Today [syncWorkflow.ts](server/private/lib/idpAPI/syncWorkflow.ts) acts as if it owns every row with `autoProvisioned` or `directorySynched`.
   - Bug: when a user disappears from the IdP, sync removes their membership even if only JIT created it. Sync should only remove rows with `directorySynched`. If JIT also owns the row, sync should just clear its own flag and leave the row.
   - When sync updates a row only JIT owned, it should set `directorySynched = true` too.
   - Check the login side too ([validateOidcCallback.ts](server/routers/idp/validateOidcCallback.ts)). It only removes rows with `autoProvisioned`, which looks right, but when JIT and sync share a row, login should clear its own flag instead of deleting the row.
2. **Fix: sync removes users even when deletions are off.** `directorySyncDeletions` is saved but sync never reads it.
   - Skip removals when it's off.
   - Never remove after a failed or partial fetch.
   - Add the circuit breaker.
3. **Make sync actually run.** The interval constant and variable exist in `syncWorkflow.ts`, but nothing starts them.
   - Start the `setInterval` in the private `startSchedulers`. Sync IdPs one after another (today it runs them all at once with `Promise.allSettled`) and log each failure.
   - Add `POST /idp/:idpId/sync` (with dry run) and the "Sync now" button.
4. **"Create missing roles" checkbox in the UI.** One per method in [IdpMappingTabs.tsx](src/components/IdpMappingTabs.tsx), following the shared/separate toggle, plus the default on global IdPs.
5. **Manual switch, the rest.** Org IdPs are done. Still to do:
   - Refuse IdPs with `allowManualProvisioning = false` in [createOrgUser.ts](server/routers/user/createOrgUser.ts), and hide them on the create-user page.
   - Add it to the global IdP API and pages.
6. **Docs.** Claims per provider, plus the Azure and Google setup guides.
7. **Data migration for existing installs** (runs on **production** data, so be careful):
   - Copy `roleMapping` → `syncRoleMapping`, `orgMapping` → `syncOrgMapping`, and `directorySyncEnabled` → `apiIntegrationEnabled`.
   - Where the JIT and sync mappings end up different, set `mappingsLinked = false`. Otherwise the shared editor would overwrite one of them.
   - Before adding the unique index on `(idpId, username)`, find and fix IdPs that have two users with the same username, or the migration fails.

## Open questions

- **IdPs that use `email` as `identifierPath`:** they keep working, but if a user changes their email they get a new account. Switching them to `oid` / `sub` means rewriting every existing user's username. Do we offer that migration?
