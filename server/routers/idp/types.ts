import "@server/extendZod";
import { z } from "zod";
import { createSelectSchema } from "drizzle-zod";
import { idp, idpOidcConfig } from "@server/db";

export const IdpSchema = createSelectSchema(idp, {
    autoProvision: (s) =>
        s.openapi({
            description:
                "Whether users are created and added to organizations on first login."
        }),
    defaultOrgMapping: (s) =>
        s.openapi({
            description:
                "JMESPath expression evaluated against the ID token to pick the user's organizations."
        }),
    defaultRoleMapping: (s) =>
        s.openapi({
            description:
                "JMESPath expression evaluated against the ID token to pick the user's role."
        }),
    idpId: (s) =>
        s.openapi({ description: "Numeric ID of the identity provider." }),
    name: (s) => s.openapi({ description: "Identity provider name." }),
    sessionRevalidation: (s) =>
        s.openapi({
            description:
                "Whether sessions are periodically revalidated with the provider."
        }),
    tags: (s) =>
        s.openapi({
            description:
                "Tags attached to the provider, as a comma separated string."
        }),
    type: (s) =>
        s.openapi({ description: "Identity provider type, for example oidc." })
});

export const IdpOidcConfigSchema = createSelectSchema(idpOidcConfig, {
    authUrl: (s) => s.openapi({ description: "Authorization endpoint URL." }),
    clientId: (s) => s.openapi({ description: "OAuth client ID." }),
    clientSecret: (s) => s.openapi({ description: "OAuth client secret." }),
    emailPath: (s) =>
        s.openapi({
            description: "Claim in the ID token that holds the user's email."
        }),
    identifierPath: (s) =>
        s.openapi({
            description:
                "Claim in the ID token that uniquely identifies the user."
        }),
    idpId: (s) =>
        s.openapi({
            description:
                "ID of the identity provider the configuration belongs to."
        }),
    idpOauthConfigId: (s) =>
        s.openapi({ description: "Numeric ID of the OIDC configuration." }),
    namePath: (s) =>
        s.openapi({
            description: "Claim in the ID token that holds the user's name."
        }),
    scopes: (s) =>
        s.openapi({
            description: "Space separated OAuth scopes requested at login."
        }),
    tokenUrl: (s) => s.openapi({ description: "Token endpoint URL." }),
    variant: (s) =>
        s.openapi({
            description:
                "OIDC flavor of the provider, for example generic, google or azure."
        })
});

export const IdpWithConfigSchema = z.object({
    idp: IdpSchema,
    idpOidcConfig: IdpOidcConfigSchema.nullable().openapi({
        description: "OIDC settings. Null for providers that are not OIDC."
    })
});
