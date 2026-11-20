import "@server/extendZod";
import { z } from "zod";
import { createSelectSchema } from "drizzle-zod";
import { userOrgRoles, userOrgs, users } from "@server/db";

export type AddUserRoleResponse = z.infer<typeof UserOrgRoleSchema>;

/** Legacy POST /role/:roleId/add/:userId response shape (membership + effective role). */
export type AddUserRoleLegacyResponse = z.infer<
    typeof AddUserRoleLegacyResponseDataSchema
>;

export type SetUserOrgRolesParams = {
    orgId: string;
    userId: string;
};

export type SetUserOrgRolesBody = {
    roleIds: number[];
};

export const UserOrgSchema = createSelectSchema(userOrgs, {
    autoProvisioned: (s) =>
        s.openapi({
            description:
                "Whether the user was added automatically by an identity provider."
        }),
    isOwner: (s) =>
        s.openapi({ description: "Whether the user owns the organization." }),
    orgId: (s) => s.openapi({ description: "ID of the organization." }),
    pamUsername: (s) =>
        s.openapi({
            description: "Unix username the user gets on SSH resources."
        }),
    userId: (s) => s.openapi({ description: "ID of the user." })
});

export const UserOrgRoleSchema = createSelectSchema(userOrgRoles, {
    orgId: (s) => s.openapi({ description: "ID of the organization." }),
    roleId: (s) => s.openapi({ description: "Numeric ID of the role." }),
    userId: (s) => s.openapi({ description: "ID of the user." })
});

export const UserSummarySchema = createSelectSchema(users, {
    userId: (s) => s.openapi({ description: "ID of the user." }),
    username: (s) => s.openapi({ description: "Username of the user." }),
    type: (s) =>
        s.openapi({
            description:
                "How the user signs in, either an internal account or an identity provider type (e.g. oidc)."
        }),
    idpId: (s) =>
        s.openapi({
            description:
                "ID of the identity provider the user belongs to. Null for internal users."
        }),
    email: (s) => s.openapi({ description: "Email of the user." })
})
    .pick({
        userId: true,
        username: true,
        type: true,
        idpId: true,
        email: true
    })
    .extend({
        idpName: z.string().nullable().openapi({
            description:
                "Name of the identity provider the user belongs to. Null for internal users."
        })
    });

export const OrgUserSchema = createSelectSchema(users, {
    email: (s) => s.openapi({ description: "Email of the user." }),
    name: (s) => s.openapi({ description: "Display name of the user." }),
    idpId: (s) =>
        s.openapi({
            description:
                "ID of the identity provider the user belongs to. Null for internal users."
        })
})
    .pick({ email: true, name: true, idpId: true })
    .extend(
        createSelectSchema(userOrgs, {
            orgId: (s) => s.openapi({ description: "ID of the organization." }),
            isOwner: (s) =>
                s.openapi({
                    description: "Whether the user owns the organization."
                }),
            autoProvisioned: (s) =>
                s.openapi({
                    description:
                        "Whether the user was added automatically by an identity provider."
                })
        }).pick({ orgId: true, isOwner: true, autoProvisioned: true }).shape
    )
    .extend({
        userId: z
            .string()
            .openapi({ description: "ID of the user." })
            .nullable(),
        username: z
            .string()
            .openapi({ description: "Username of the user." })
            .nullable(),
        type: z
            .string()
            .openapi({
                description:
                    "How the user signs in, either an internal account or an identity provider type (e.g. oidc)."
            })
            .nullable(),
        twoFactorEnabled: z
            .boolean()
            .openapi({
                description:
                    "Whether the user has two-factor authentication enabled."
            })
            .nullable(),
        idpName: z.string().nullable().openapi({
            description:
                "Name of the identity provider the user belongs to. Null for internal users."
        }),
        idpType: z.string().nullable().openapi({
            description: "Type of the identity provider the user belongs to."
        }),
        idpVariant: z.string().nullable().openapi({
            description:
                "Variant of the identity provider (for example the OIDC flavor)."
        }),
        isAdmin: z.boolean().openapi({
            description:
                "Whether the user has the admin role in the organization."
        }),
        roleIds: z.array(z.number().int()).openapi({
            description: "IDs of the roles the user has in the organization."
        }),
        roles: z
            .array(
                z.object({
                    roleId: z
                        .number()
                        .int()
                        .openapi({ description: "Numeric ID of the role." }),
                    name: z.string().openapi({ description: "Role name." }),
                    isAdmin: z.boolean().openapi({
                        description: "Whether this is the built-in admin role."
                    })
                })
            )
            .openapi({ description: "Roles the user has in the organization." })
    });

export const AddUserRoleLegacyResponseDataSchema = UserOrgSchema.extend({
    roleId: UserOrgRoleSchema.shape.roleId
});
