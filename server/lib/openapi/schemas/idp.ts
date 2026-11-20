import "@server/extendZod";
import { z } from "zod";

export const IdpSchema = z.object({
    idpId: z.number().int().openapi({
        description: "Numeric ID of the identity provider."
    }),
    name: z.string().openapi({ description: "Identity provider name." }),
    type: z
        .string()
        .openapi({ description: "Identity provider type, for example oidc." }),
    autoProvision: z.boolean().openapi({
        description:
            "Whether users are created and added to organizations on first login."
    }),
    defaultRoleMapping: z.string().nullable().openapi({
        description:
            "JMESPath expression evaluated against the ID token to pick the user's role."
    }),
    defaultOrgMapping: z.string().nullable().openapi({
        description:
            "JMESPath expression evaluated against the ID token to pick the user's organizations."
    }),
    sessionRevalidation: z.boolean().openapi({
        description:
            "Whether sessions are periodically revalidated with the provider."
    }),
    tags: z.string().nullable().openapi({
        description:
            "Tags attached to the provider, as a comma separated string."
    })
});

export const IdpOidcConfigSchema = z.object({
    idpOauthConfigId: z.number().int().openapi({
        description: "Numeric ID of the OIDC configuration."
    }),
    idpId: z.number().int().openapi({
        description: "ID of the identity provider the configuration belongs to."
    }),
    variant: z.string().openapi({
        description:
            "OIDC flavor of the provider, for example generic, google or azure."
    }),
    clientId: z.string().openapi({ description: "OAuth client ID." }),
    clientSecret: z.string().openapi({ description: "OAuth client secret." }),
    authUrl: z.string().openapi({ description: "Authorization endpoint URL." }),
    tokenUrl: z.string().openapi({ description: "Token endpoint URL." }),
    identifierPath: z.string().openapi({
        description: "Claim in the ID token that uniquely identifies the user."
    }),
    emailPath: z.string().nullable().openapi({
        description: "Claim in the ID token that holds the user's email."
    }),
    namePath: z.string().nullable().openapi({
        description: "Claim in the ID token that holds the user's name."
    }),
    scopes: z.string().openapi({
        description: "Space separated OAuth scopes requested at login."
    })
});

export const IdpWithConfigSchema = z.object({
    idp: IdpSchema,
    idpOidcConfig: IdpOidcConfigSchema.nullable().openapi({
        description: "OIDC settings. Null for providers that are not OIDC."
    })
});

export const OrgIdpWithConfigSchema = IdpWithConfigSchema.extend({
    redirectUrl: z.string().openapi({
        description: "Redirect URL to register with the identity provider."
    })
});

export const OrgIdpCreatedSchema = z.object({
    idpId: IdpSchema.shape.idpId,
    redirectUrl: z.string().openapi({
        description: "Redirect URL to register with the identity provider."
    })
});

export const OrgIdpListItemSchema = z.object({
    idpId: IdpSchema.shape.idpId,
    orgId: z.string().openapi({ description: "ID of the organization." }),
    name: IdpSchema.shape.name,
    type: IdpSchema.shape.type,
    variant: z.string().nullable().openapi({
        description: "OIDC flavor of the provider."
    }),
    tags: IdpSchema.shape.tags
});
