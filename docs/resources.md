# Resources: public vs private

Pangolin has two kinds of resource. The names vary across the codebase, the UI,
the API and blueprints, so learn the mapping:

| | Public resource | Private resource |
| --- | --- | --- |
| Other names | proxy resource, `resource` | site resource, client resource, `siteResource` |
| What it is | Exposed through Traefik on a domain/port, protected by Pangolin auth | Reachable only by Pangolin clients (Olm) over the tunnel |
| DB table | `resources` (`resourceId`, `resourceGuid`, `niceId`) | `siteResources` (`siteResourceId`, `niceId`) |
| Modes (`mode`) | `http`, `tcp`, `udp`, `ssh`, `rdp`, `vnc`, `inference` | `host`, `cidr`, `http`, `ssh`, `inference`, `gateway` |
| Backends | `targets` table (`server/routers/target/`) | Fields on the site resource itself + `siteNetworks`/`networks` |
| Access join tables | `roleResources`, `userResources`, `resourceWhitelist`, policies | `roleSiteResources`, `userSiteResources`, `clientSiteResources` |
| Labels | `resourceLabels` | `siteResourceLabels` |
| AI | `resourceAiProviders`, `resourceAiModels` | `siteResourceAiProviders`, `siteResourceAiModels` |
| Server router | `server/routers/resource/` (+ `server/private/routers/resource/`) | `server/routers/siteResource/` |
| Access middleware | `verifyResourceAccess` / `verifyApiKeyResourceAccess` | `verifySiteResourceAccess` / `verifyApiKeySiteResourceAccess` |
| Delete helper | `server/lib/deleteResource.ts` | `server/lib/deleteSiteResource.ts` |
| Blueprint key | `public-resources` (legacy alias `proxy-resources`) | `private-resources` (legacy alias `client-resources`) |
| Blueprint schema | `PublicResourceSchema` in `server/lib/blueprints/types.ts` | `PrivateResourceSchema` in the same file |
| Blueprint apply | `server/lib/blueprints/publicResources.ts` → `updatePublicResources` | `server/lib/blueprints/privateResources.ts` → `updatePrivateResources` |
| Blueprint export | `buildPublicResourceBlueprintConfig` in `server/lib/blueprints/exportResourceBlueprint.ts` | `buildPrivateResourceBlueprintConfig` in the same file |
| Integration API path | `/resource/...` **and** `/public-resource/...` | `/site-resource/...` **and** `/private-resource/...` |
| OpenAPI tags | `PublicResource` + `PublicResourceLegacy` | `PrivateResource` + `PrivateResourceLegacy` |
| UI pages | `src/app/[orgId]/settings/resources/public/` | `src/app/[orgId]/settings/resources/private/` |
| UI context | `ResourceProvider` / `useResourceContext` | `SiteResourceProvider` / `useSiteResourceContext`, `useSaveSiteResource` |
| Traefik config | `server/lib/traefik/getTraefikConfig.ts` (+ private override) | `server/lib/traefik/siteResourceAlias.ts` (cert placeholders for http-mode aliases) |

"Every resource" means both columns. When you add a capability to one kind, check
whether the other needs it too.

## Checklist: changing what a resource can be configured with

Use this whenever you touch `createResource`, `updateResource`,
`createSiteResource` or `updateSiteResource` (a new field, a renamed field, new
enum values, or a new mode). The blueprint must be able to do everything the API
can do.

1. **DB**: add the column to **both** `server/db/pg/schema/schema.ts` and
   `server/db/sqlite/schema/schema.ts` using portable types (see
   `docs/database.md`). Use `privateSchema.ts` if the feature is enterprise-only.
   Don't write a migration script. If existing rows need values copied or
   generated, add them to the release's migration notes
   (`server/setup/migrationNotes/<version>.md`).
2. **API handlers**: update the zod body schemas in
   - `server/routers/resource/createResource.ts`, `updateResource.ts`, or
   - `server/routers/siteResource/createSiteResource.ts`, `updateSiteResource.ts`

   and the `get`/`list` response types if the field is returned.
3. **Blueprint schema**: add the field to `PublicResourceSchema` or
   `PrivateResourceSchema` in `server/lib/blueprints/types.ts`. Blueprint keys are
   **kebab-case** (e.g. `"auth-daemon"`, `"estimated-time"`). DB/API fields are
   camelCase. Enterprise-only blueprint fragments get a `#dynamic` schema with an
   empty OSS stub, like `server/lib/blueprints/MaintenanceSchema.ts` ↔
   `server/private/lib/blueprints/MaintenanceSchema.ts`.
4. **Blueprint apply**: map the blueprint field to the DB column in both the
   create and the update branches of `updatePublicResources`
   (`publicResources.ts`) or `updatePrivateResources` (`privateResources.ts`).
   Mirror any paywall or tier checks the API handler does (see how
   `tierMatrix.maintenancePage` is enforced there).
5. **Blueprint export**: emit the field in `buildPublicResourceBlueprintConfig` or
   `buildPrivateResourceBlueprintConfig` (`exportResourceBlueprint.ts`) so a
   resource round-trips through export and apply.
6. **Docker labels**: Newt docker labels (`pangolin.public-resources.*` /
   `pangolin.proxy-resources.*` and `pangolin.private-resources.*` /
   `pangolin.client-resources.*`) are parsed by
   `parseDockerContainers.ts` / `parseDotNotation.ts` into the same schema. They
   usually work once the schema is updated. Check them if the field is an array or
   object.
7. **Integration API**: if you add a route, register it in
   `server/routers/integration.ts` (or the private one) with **both** paths (see
   below), and add a `registry.registerPath` per path with the right OpenAPI tag.
8. **UI**: update the relevant tab page under
   `src/app/[orgId]/settings/resources/{public,private}/[niceId]/` and the create
   page. All strings go in `messages/en-US.json`.
9. **Traefik / Newt / Olm**: if the field changes routing, update
   `server/lib/traefik/` (public) or the Newt/Olm message builders in
   `server/routers/newt/` and `server/routers/olm/` (private).

## Integration API aliases

Integration API resource routes always register the legacy path **and** the new
alias in one array:

```ts
authenticated.put(
    ["/org/:orgId/resource", "/org/:orgId/public-resource"],
    verifyApiKeyOrgAccess,
    verifyLimits,
    verifyApiKeyHasAction(ActionsEnum.createResource),
    logActionAudit(ActionsEnum.createResource),
    resource.createResource
);

authenticated.get(
    ["/site-resource/:siteResourceId", "/private-resource/:siteResourceId"],
    verifyApiKeySiteResourceAccess,
    verifyApiKeyHasAction(ActionsEnum.getSiteResource),
    siteResource.getSiteResource
);
```

Mapping: `resource(s)` → `public-resource(s)`, `resource-policy`/`resource-policies`
→ `public-resource-policy`/`public-resource-policies`, `site-resource(s)` →
`private-resource(s)`.

The handler registers OpenAPI docs for both: the legacy path with
`OpenAPITags.PublicResourceLegacy` (or `PrivateResourceLegacy`) and the alias
with `OpenAPITags.PublicResource` (or `PrivateResource`). See
`server/routers/resource/createResource.ts` and
`server/routers/siteResource/createSiteResource.ts`.

The dashboard routes in `server/routers/external.ts` don't need the alias.

## Related code

- Access checks: `server/auth/canUserAccessResource.ts`,
  `server/auth/canUserAccessSiteResource.ts`, `server/lib/canUserAccessResource.ts`.
- Client ↔ site resource access recomputation:
  `server/lib/rebuildClientAssociations.ts` (call it after changing who can
  reach a site resource).
- Resource policies (shared auth and rules for public resources):
  `server/routers/policy/`, `server/private/routers/policy/`, blueprint
  `public-policies` → `server/lib/blueprints/resourcePolicies.ts`.
- Applying blueprints: `server/lib/blueprints/applyBlueprint.ts`, routes in
  `server/routers/blueprints/`, UI in `src/app/[orgId]/settings/blueprints/`.
