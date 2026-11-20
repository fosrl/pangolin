import "@server/extendZod";
import { z } from "zod";

const userId = z.string().openapi({ description: "ID of the user." });
const email = z
    .string()
    .nullable()
    .openapi({ description: "Email of the user." });
const username = z.string().openapi({ description: "Username of the user." });
const name = z
    .string()
    .nullable()
    .openapi({ description: "Display name of the user." });
const userType = z.string().openapi({
    description:
        "How the user signs in, either an internal account or an identity provider type (e.g. oidc)."
});
const idpName = z.string().nullable().openapi({
    description:
        "Name of the identity provider the user belongs to. Null for internal users."
});
const idpId = z.number().int().nullable().openapi({
    description:
        "ID of the identity provider the user belongs to. Null for internal users."
});
const idpType = z.string().nullable().openapi({
    description: "Type of the identity provider the user belongs to."
});
const idpVariant = z.string().nullable().openapi({
    description:
        "Variant of the identity provider (for example the OIDC flavor)."
});
const twoFactorEnabled = z.boolean().openapi({
    description: "Whether the user has two-factor authentication enabled."
});
const dateCreated = z
    .string()
    .openapi({ description: "ISO timestamp when the user was created." });
const isOwner = z.boolean().openapi({
    description: "Whether the user owns the organization."
});

export const AdminUserSchema = z.object({
    userId,
    email,
    username,
    name,
    type: userType,
    twoFactorEnabled,
    twoFactorSetupRequested: z.boolean().nullable().openapi({
        description:
            "Whether an admin has asked the user to set up two-factor authentication."
    }),
    emailVerified: z
        .boolean()
        .openapi({ description: "Whether the user's email is verified." }),
    serverAdmin: z
        .boolean()
        .openapi({ description: "Whether the user is a server admin." }),
    idpName,
    idpId,
    dateCreated
});

export const AdminUserListItemSchema = AdminUserSchema.omit({
    userId: true,
    emailVerified: true
}).extend({
    id: userId
});

export const OrgUserSchema = z.object({
    orgId: z.string().openapi({ description: "ID of the organization." }),
    userId: userId.nullable(),
    email,
    username: username.nullable(),
    name,
    type: userType.nullable(),
    isOwner,
    twoFactorEnabled: twoFactorEnabled.nullable(),
    autoProvisioned: z.boolean().nullable().openapi({
        description:
            "Whether the user was added automatically by an identity provider."
    }),
    idpId,
    idpName,
    idpType,
    idpVariant,
    isAdmin: z.boolean().openapi({
        description: "Whether the user has the admin role in the organization."
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

export const OrgUserListItemSchema = z.object({
    id: userId,
    email,
    emailVerified: z
        .boolean()
        .openapi({ description: "Whether the user's email is verified." }),
    dateCreated,
    orgId: z
        .string()
        .nullable()
        .openapi({ description: "ID of the organization." }),
    username,
    name,
    type: userType,
    isOwner: isOwner.nullable(),
    idpName,
    idpId,
    idpType,
    idpVariant,
    twoFactorEnabled,
    roles: z
        .array(
            z.object({
                roleId: z
                    .number()
                    .int()
                    .openapi({ description: "Numeric ID of the role." }),
                roleName: z.string().openapi({ description: "Role name." })
            })
        )
        .openapi({ description: "Roles the user has in the organization." })
});

export const UserOrgSchema = z.object({
    userId,
    orgId: z.string().openapi({ description: "ID of the organization." }),
    isOwner,
    autoProvisioned: z.boolean().nullable().openapi({
        description:
            "Whether the user was added automatically by an identity provider."
    }),
    pamUsername: z.string().nullable().openapi({
        description: "Unix username the user gets on SSH resources."
    })
});

export const UserOrgRoleSchema = z.object({
    userId,
    orgId: z.string().openapi({ description: "ID of the organization." }),
    roleId: z.number().int().openapi({ description: "Numeric ID of the role." })
});

export const InvitationListItemSchema = z.object({
    inviteId: z.string().openapi({ description: "ID of the invitation." }),
    email: z
        .string()
        .openapi({ description: "Email the invitation was sent to." }),
    expiresAt: z.number().int().openapi({
        description: "Epoch milliseconds when the invitation expires."
    }),
    roles: z
        .array(
            z.object({
                roleId: z
                    .number()
                    .int()
                    .openapi({ description: "Numeric ID of the role." }),
                roleName: z
                    .string()
                    .nullable()
                    .openapi({ description: "Role name." })
            })
        )
        .openapi({ description: "Roles the user receives when accepting." })
});

export const OrgAccessCheckSchema = z.object({
    allowed: z.boolean().openapi({
        description:
            "Whether the user satisfies the organization's access policies."
    }),
    error: z.string().optional().openapi({
        description: "Why access was denied, when it was."
    }),
    policies: z
        .object({
            requiredTwoFactor: z.boolean().optional().openapi({
                description: "Whether two-factor authentication is required."
            }),
            maxSessionLength: z
                .object({
                    compliant: z.boolean(),
                    maxSessionLengthHours: z.number(),
                    sessionAgeHours: z.number()
                })
                .optional()
                .openapi({
                    description: "Result of the maximum session length policy."
                }),
            passwordAge: z
                .object({
                    compliant: z.boolean(),
                    maxPasswordAgeDays: z.number(),
                    passwordAgeDays: z.number()
                })
                .optional()
                .openapi({
                    description: "Result of the password expiry policy."
                })
        })
        .optional()
        .openapi({ description: "Per-policy results." })
});
