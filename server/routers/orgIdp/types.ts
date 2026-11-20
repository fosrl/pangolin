import "@server/extendZod";
import { z } from "zod";
import { createSelectSchema } from "drizzle-zod";
import { idp, idpOrg } from "@server/db";
import { LimitOffsetPaginationSchema } from "@server/lib/openapi/pagination";
import { IdpSchema, IdpWithConfigSchema } from "@server/routers/idp/types";

export type ListUserAdminOrgIdpsEntry = {
    idpId: number;
    orgId: string;
    orgName: string;
    name: string;
    type: string;
    variant: string;
    tags: string | null;
};

export type ListUserAdminOrgIdpsResponse = {
    idps: ListUserAdminOrgIdpsEntry[];
    pagination: {
        total: number;
        limit: number;
        offset: number;
    };
};

export const OrgIdpCreatedSchema = z.object({
    idpId: IdpSchema.shape.idpId,
    redirectUrl: z.string().openapi({
        description: "Redirect URL to register with the identity provider."
    })
});
export type CreateOrgIdpResponse = z.infer<typeof OrgIdpCreatedSchema>;

export const GetOrgIdpResponseDataSchema = IdpWithConfigSchema.extend({
    redirectUrl: z.string().openapi({
        description: "Redirect URL to register with the identity provider."
    })
});
export type GetOrgIdpResponse = z.infer<typeof GetOrgIdpResponseDataSchema>;

const OrgIdpListItemSchema = createSelectSchema(idp, {
    tags: (s) =>
        s.openapi({ description: "Numeric ID of the identity provider." })
})
    .pick({ tags: true })
    .extend(
        createSelectSchema(idpOrg, {
            orgId: (s) => s.openapi({ description: "ID of the organization." })
        }).pick({ orgId: true }).shape
    )
    .extend({
        idpId: z.object({
            idpId: z.number().int().openapi({
                description: "Numeric ID of the identity provider."
            }),
            name: z
                .string()
                .openapi({ description: "Identity provider name." }),
            type: z.string().openapi({
                description: "Identity provider type, for example oidc."
            }),
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
        }).shape.idpId,
        name: z.object({
            idpId: z.number().int().openapi({
                description: "Numeric ID of the identity provider."
            }),
            name: z
                .string()
                .openapi({ description: "Identity provider name." }),
            type: z.string().openapi({
                description: "Identity provider type, for example oidc."
            }),
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
        }).shape.name,
        type: z.object({
            idpId: z.number().int().openapi({
                description: "Numeric ID of the identity provider."
            }),
            name: z
                .string()
                .openapi({ description: "Identity provider name." }),
            type: z.string().openapi({
                description: "Identity provider type, for example oidc."
            }),
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
        }).shape.type,
        variant: z.string().nullable().openapi({
            description: "OIDC flavor of the provider."
        })
    });

export const ListOrgIdpsResponseDataSchema = z.object({
    idps: z.array(OrgIdpListItemSchema),
    pagination: LimitOffsetPaginationSchema
});
export type ListOrgIdpsResponse = z.infer<typeof ListOrgIdpsResponseDataSchema>;
