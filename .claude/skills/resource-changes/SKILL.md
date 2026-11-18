---
name: resource-changes
description: Use whenever a task touches public resources (proxy resources, `resources` table, `server/routers/resource/`) or private resources (site resources, client resources, `siteResources` table, `server/routers/siteResource/`). That includes adding or changing fields, modes or settings on createResource/updateResource/createSiteResource/updateSiteResource, resource integration API routes, resource blueprints (public-resources/private-resources), or the resource settings pages in the dashboard.
---

Read `docs/resources.md` before changing code. It maps every name, table,
router, middleware, blueprint file and UI path for both resource kinds.

Naming: **public resource = proxy resource = `resource` (`resources` table)**.
**Private resource = site resource = client resource = `siteResource`
(`siteResources` table)**. "Every resource" means both. Check whether the other
kind needs the same change.

Required whenever create/update for either kind changes (follow §"Checklist" in
the doc, in order):

1. Both DB dialects: `server/db/{pg,sqlite}/schema/schema.ts`, portable types
   only. No migration scripts. Add migration notes if existing rows need data
   work (load `db-schema-change`).
2. API zod body schemas in `create*/update*` handlers, plus get/list response
   types.
3. **Blueprint schema** in `server/lib/blueprints/types.ts`
   (`PublicResourceSchema` / `PrivateResourceSchema`, kebab-case keys).
4. **Blueprint apply** in `server/lib/blueprints/publicResources.ts` /
   `privateResources.ts`, in both the create and update branches, mirroring any
   tier checks.
5. **Blueprint export** in `server/lib/blueprints/exportResourceBlueprint.ts`
   so the field round-trips.
6. Integration API: every resource route registers **both** paths in one array:
   `/resource/...` + `/public-resource/...`, `/site-resource/...` +
   `/private-resource/...`. Register OpenAPI for both (legacy tag +
   `PublicResource`/`PrivateResource` tag).
7. UI tab page under `src/app/[orgId]/settings/resources/{public,private}/[niceId]/`
   and the create page. All strings go in `messages/en-US.json` only (load the
   `dashboard-ui` skill).

Say in your summary which of these steps you did and which didn't apply.
