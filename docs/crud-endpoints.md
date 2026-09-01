# How to build a CRUD endpoint in this repo

Reference for adding a new CRUD entity to the server. Based on two real
examples already in the codebase — read them side by side with this doc:

- **Public / open-source (Community Edition) pattern**: `server/routers/aiProvider/`
- **Enterprise-only pattern**: `server/private/routers/alertRule/`

The two are structurally identical. The only difference is *where the files
live* and *which router they get wired into*.

## 1. Decide: public or private?

- `server/routers/<entity>/` — ships in the open-source Community Edition.
  Anyone running Pangolin gets this.
- `server/private/routers/<entity>/` — Enterprise/SaaS only. Gated behind
  `verifyValidLicense` (and often `verifyValidSubscription(tierMatrix.x)`).
  Every file here starts with the Fossorial Commercial License header block
  (copy it verbatim from an existing private file).

Everything below applies to both — swap `@server/...` for `#private/...`
import paths and add license headers when building the private version.

## 2. Directory layout

One folder per entity, one file per operation, a barrel `index.ts`:

```
server/routers/<entity>/
  index.ts          # export * from each operation file + ./types
  types.ts          # response payload types + row->public mapper
  validation.ts      # zod schemas/refinements shared by create + update (optional)
  create<Entity>.ts
  list<Entities>.ts
  get<Entity>.ts
  update<Entity>.ts
  delete<Entity>.ts
```

`index.ts` is a flat barrel:

```ts
export * from "./createAiProvider";
export * from "./listAiProviders";
export * from "./getAiProvider";
export * from "./updateAiProvider";
export * from "./deleteAiProvider";
export * from "./types";
```

## 3. Anatomy of a single handler

Every handler file (`create<Entity>.ts`, etc.) follows the same shape:

```ts
import { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { <table>, db } from "@server/db";
import response from "@server/lib/response";
import HttpCode from "@server/types/HttpCode";
import createHttpError from "http-errors";
import logger from "@server/logger";
import { fromError } from "zod-validation-error";
import { OpenAPITags, registry } from "@server/openApi";
import { eq } from "drizzle-orm";
import type { GetXResponse } from "@server/routers/<entity>/types";

const paramsSchema = z.strictObject({
    orgId: z.string().nonempty()          // or entityId: z.coerce.number().int().positive()
});

const bodySchema = z.strictObject({ /* ... */ }); // create/update only

registry.registerPath({
    method: "get", // put | post | delete
    path: "/org/{orgId}/x",
    description: "...",
    tags: [OpenAPITags.<Entity>],
    request: { params: paramsSchema, /* body: {...} for write ops, query: for list */ },
    responses: { 200: { description: "Successful response" } }
});

export async function getX(req: Request, res: Response, next: NextFunction): Promise<any> {
    try {
        const parsedParams = paramsSchema.safeParse(req.params);
        if (!parsedParams.success) {
            return next(createHttpError(HttpCode.BAD_REQUEST, fromError(parsedParams.error).toString()));
        }
        // parse body too, if present, same pattern

        // ...business logic against db...

        if (!row) {
            return next(createHttpError(HttpCode.NOT_FOUND, `X with ID ${id} not found`));
        }

        return response<GetXResponse>(res, {
            data: { /* ... */ },
            success: true,
            error: false,
            message: "X retrieved successfully",
            status: HttpCode.OK
        });
    } catch (error) {
        logger.error(error);
        return next(createHttpError(HttpCode.INTERNAL_SERVER_ERROR, "An error occurred"));
    }
}
```

Rules to keep consistent with the rest of the codebase:

- `z.strictObject` for params/body — rejects unknown keys.
- Params parsed first, then body; each on its own `safeParse` + early
  `next(createHttpError(...))` — never throw raw errors.
- Every handler registers itself with the OpenAPI `registry` even if nobody
  reads the spec directly — it's how `/api/v1/docs` stays accurate.
- Catch-all `try/catch` at the bottom: `logger.error(error)` +
  generic `500` message. Never leak internal error details to the client.
- Use `response<T>(res, { data, success, error, message, status })` from
  `@server/lib/response` for every response, success or otherwise (errors go
  through `next(createHttpError(...))` instead, not through `response`).
- If the route already ran an access-control middleware that fetched the row
  (see §5), reuse it instead of re-querying:
  `req.aiProvider && req.aiProvider.providerId === providerId ? [req.aiProvider] : await db.select()...`

### List handler specifics

Pagination is a fixed shape (`page`, `pageSize`, optional `query` for
search). See `listAiProviders.ts`:

```ts
const listSchema = z.object({
    pageSize: z.coerce.number<string>().int().positive().optional().catch(20).default(20),
    page: z.coerce.number<string>().int().min(0).optional().catch(1).default(1),
    query: z.string().optional()
});
```

Run the count query and the page query in `Promise.all`, and return
`PaginatedResponse<{ items: T[] }>` (`@server/types/Pagination`) with
`{ total, pageSize, page }`.

### types.ts specifics

- Define one response type per operation: `List<Entities>Response`,
  `Get<Entity>Response`, `CreateOrEdit<Entity>Response` (create and update
  commonly share a response shape).
- If the raw DB row needs to be shaped for clients (decrypting secrets,
  parsing a serialized column, hiding a column), put a `toPublic<Entity>()`
  mapper here — see `toPublicAiProvider` for the pattern of stripping
  `apiKey`/serialized columns and re-adding decrypted/parsed versions.

### validation.ts specifics

Only needed when create and update share non-trivial zod pieces (enums,
`superRefine` cross-field rules). Export the raw schemas (`z.enum([...])`)
and refinement functions, and import them into both `createX.ts` and
`updateX.ts` — see `aiProvider/validation.ts`'s
`refineProviderUpstreamFields`.

## 4. Wire up an access-control middleware (for id-scoped routes)

For routes scoped to a single row (`/x/:xId`, as opposed to
`/org/:orgId/x` create/list), add a `verify<Entity>Access` middleware in
`server/middlewares/` (or `server/private/middlewares/` for enterprise-only
entities) and export it from that directory's `index.ts`.

Pattern (`verifyAiProviderAccess.ts`):

1. Read the id param, `Number.parseInt`/validate it.
2. Load the row by id.
3. `404` if it doesn't exist.
4. Resolve the row's `orgId`, then check/attach `req.userOrg` (query
   `userOrgs` if not already on the request), `403` if the user isn't in
   that org.
5. Run `checkOrgAccessPolicy` if `req.orgPolicyAllowed` hasn't been resolved
   yet.
6. Set `req.userOrgId`, `req.userOrgRoleIds`, and stash the row on the
   request (e.g. `req.aiProvider = provider`) so downstream handlers and
   `verifyUserHasAction` don't have to refetch it.

Org-scoped create/list routes (`/org/:orgId/x`) don't need a bespoke
middleware — they use the existing generic `verifyOrgAccess` from
`@server/middlewares`.

## 5. Register an action + permission check

Add one `ActionsEnum` entry per operation in `server/auth/actions.ts`,
grouped near the entity's other actions, named `create<Entity>`,
`get<Entity>`, `update<Entity>`, `delete<Entity>`, `list<Entities>`:

```ts
createAiProvider = "createAiProvider",
deleteAiProvider = "deleteAiProvider",
getAiProvider = "getAiProvider",
listAiProviders = "listAiProviders",
updateAiProvider = "updateAiProvider",
```

Every route uses `verifyUserHasAction(ActionsEnum.x)` to check the caller's
role/permissions for that action, and mutating routes (create/update/delete)
follow it with `logActionAudit(ActionsEnum.x)` to record the action in the
audit log.

## 6. Register the routes

There are four router files; which one(s) you touch depends on public vs.
private and user-facing vs. service-to-service:

| File | Purpose |
|---|---|
| `server/routers/external.ts` | Public, user-facing API. Exports `authenticated`, `unauthenticated`, `authRouter` Express routers. |
| `server/routers/internal.ts` | Public, internal service-to-service API (gerbil, badger, traefik-config) — no user auth, exports `internalRouter`. |
| `server/private/routers/external.ts` | Enterprise-only, user-facing. Imports `authenticated`/`unauthenticated`/`authRouter` **from the public `external.ts`** and re-exports them, then adds more routes on top. |
| `server/private/routers/internal.ts` | Enterprise-only, service-to-service. Same re-export trick with `internalRouter`. |

Private router files always start:

```ts
import {
    unauthenticated as ua,
    authenticated as a,
    authRouter as aa
} from "@server/routers/external";

export const authenticated = a;
export const unauthenticated = ua;
export const authRouter = aa;
```

...and then call `authenticated.get/put/post/delete(...)` to bolt on
additional, enterprise-only routes on the *same* router instances the public
build uses. This is why the private build has strictly more routes than the
public build, not a divergent copy.

### Route registration order (mutating vs read)

Standard middleware chain per verb, using `alertRule`'s registrations as the
template:

```ts
// Create — org-scoped, no row exists yet
authenticated.put(
    "/org/:orgId/x",
    verifyValidLicense,              // private/enterprise routes only
    verifyOrgAccess,
    verifyLimits,                    // if the entity counts against a plan limit
    verifyUserHasAction(ActionsEnum.createX),
    logActionAudit(ActionsEnum.createX),
    x.createX
);

// Update — row-scoped
authenticated.post(
    "/org/:orgId/x/:xId",            // or "/x/:xId" if id is globally unique
    verifyValidLicense,
    verifyOrgAccess,                 // or verifyXAccess if globally-keyed
    verifyUserHasAction(ActionsEnum.updateX),
    logActionAudit(ActionsEnum.updateX),
    x.updateX
);

// Delete — row-scoped
authenticated.delete(
    "/org/:orgId/x/:xId",
    verifyValidLicense,
    verifyOrgAccess,
    verifyUserHasAction(ActionsEnum.deleteX),
    logActionAudit(ActionsEnum.deleteX),
    x.deleteX
);

// List — org-scoped, read-only, no audit log
authenticated.get(
    "/org/:orgId/xs",
    verifyValidLicense,
    verifyOrgAccess,
    verifyUserHasAction(ActionsEnum.listXs),
    x.listXs
);

// Get one — row-scoped, read-only, no audit log
authenticated.get(
    "/org/:orgId/x/:xId",
    verifyValidLicense,
    verifyOrgAccess,
    verifyUserHasAction(ActionsEnum.getX),
    x.getX
);
```

Notes:

- HTTP verbs: `PUT` = create, `POST` = update, `GET` = read, `DELETE` =
  delete. This repo does not use `PATCH` for entity updates (site
  provisioning keys are the one exception, using `PATCH`).
- `verifyValidLicense` is only needed on private/enterprise routes; public
  OSS routes skip it.
- Use `verifyValidSubscription(tierMatrix.someFeature)` right after
  `verifyValidLicense` when a feature is gated to specific SaaS tiers (see
  `tierMatrix` usages in `server/private/routers/external.ts`).
- `verifyLimits` goes on create routes for entities that count against a
  plan/seat limit.
- For entities keyed by a globally-unique id (not nested under `/org/:orgId`),
  use the dedicated `verify<Entity>Access` middleware from §4 instead of
  `verifyOrgAccess` on the row-scoped routes (see how `/ai-provider/:providerId`
  uses `verifyAiProviderAccess`, while `/org/:orgId/ai-provider` create/list
  use plain `verifyOrgAccess`).
- Read-only routes (`get`, `list`) skip `logActionAudit` — only mutations are
  audited.
- `internal*.ts` routes are for trusted internal callers (gerbil/badger
  sidecars) and generally skip user-facing auth entirely, using
  `verifySessionUserMiddleware` / `verifyUserFromResourceSessionMiddleware`
  instead of `verifyOrgAccess`/`verifyUserHasAction`. CRUD entities almost
  never need internal router entries — only add one if a sidecar process
  needs direct access to the resource.

## 7. The `#dynamic` alias (advanced — most CRUD work can ignore this)

Some middleware (e.g. `logActionAudit`) needs a real implementation in the
enterprise/SaaS build but a no-op stub in the open-source build, while
being imported by identical code in `server/routers/external.ts` in both
builds. That's done via the `#dynamic/*` import alias, which
`tsconfig.oss.json` points at `./server/*` and `tsconfig.enterprise.json` /
`tsconfig.saas.json` point at `./server/private/*`. You only need this
pattern if you're adding a genuinely dual-implementation hook; a normal
private-only CRUD entity (like `alertRule`) never touches `#dynamic` — it
just lives entirely under `server/private/` and is imported with `#private/*`
directly from `server/private/routers/external.ts`.

## 8. Checklist for a new entity

1. Add the DB table to `server/db/pg/schema/schema.ts` (and sqlite schema if
   applicable).
2. Add `ActionsEnum` entries in `server/auth/actions.ts`.
3. Create `server/routers/<entity>/` (or `server/private/routers/<entity>/`):
   `types.ts`, optional `validation.ts`, one file per operation, `index.ts`
   barrel.
4. If routes are row-scoped by a global id, add
   `verify<Entity>Access.ts` to `server/middlewares/` or
   `server/private/middlewares/`, and export it from that directory's
   `index.ts`.
5. Wire routes into `external.ts` (public or private) following the verb/
   middleware table in §6. Add to `internal.ts` only if a sidecar needs
   direct access.
6. Add license header block to every new file if it's under `server/private/`.
