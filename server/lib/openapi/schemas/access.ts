import "@server/extendZod";
import { z } from "zod";

export const RoleSummarySchema = z.object({
    roleId: z
        .number()
        .int()
        .openapi({ description: "Numeric ID of the role." }),
    name: z.string().openapi({ description: "Role name." }),
    description: z.string().nullable().openapi({
        description: "Role description."
    }),
    isAdmin: z.boolean().nullable().openapi({
        description:
            "Whether this is the built-in admin role of the organization."
    })
});

export const UserSummarySchema = z.object({
    userId: z.string().openapi({ description: "ID of the user." }),
    username: z.string().openapi({ description: "Username of the user." }),
    type: z.string().openapi({
        description:
            "How the user signs in, either an internal account or an identity provider type (e.g. oidc)."
    }),
    idpName: z.string().nullable().openapi({
        description:
            "Name of the identity provider the user belongs to. Null for internal users."
    }),
    idpId: z.number().int().nullable().openapi({
        description:
            "ID of the identity provider the user belongs to. Null for internal users."
    }),
    email: z.string().nullable().openapi({ description: "Email of the user." })
});

export const ClientSummarySchema = z.object({
    clientId: z
        .number()
        .int()
        .openapi({ description: "Numeric ID of the client." }),
    name: z.string().openapi({ description: "Client name." }),
    subnet: z.string().openapi({
        description:
            "Address assigned to the client inside the overlay network."
    })
});

export const RoleSchema = z.object({
    roleId: z
        .number()
        .int()
        .openapi({ description: "Numeric ID of the role." }),
    orgId: z.string().openapi({
        description: "ID of the organization the role belongs to."
    }),
    isAdmin: z.boolean().nullable().openapi({
        description:
            "Whether this is the built-in admin role of the organization."
    }),
    name: z.string().openapi({ description: "Role name." }),
    description: z.string().nullable().openapi({
        description: "Role description."
    }),
    requireDeviceApproval: z.boolean().nullable().openapi({
        description:
            "Whether clients owned by users with this role need admin approval before they can connect."
    }),
    sshSudoMode: z.string().nullable().openapi({
        description:
            "Sudo access granted to users with this role on SSH resources: none, full or commands."
    }),
    sshSudoCommands: z.string().nullable().openapi({
        description:
            "Commands users with this role may run with sudo when sshSudoMode is commands."
    }),
    sshCreateHomeDir: z.boolean().nullable().openapi({
        description:
            "Whether a home directory is created for the user on first SSH login."
    }),
    sshUnixGroups: z.string().nullable().openapi({
        description:
            "Unix groups users with this role are added to on SSH login."
    })
});

export const RoleWithSshSchema = RoleSchema.extend({
    allowSsh: z.boolean().openapi({
        description: "Whether users with this role may sign SSH keys."
    })
});

export const RoleListItemSchema = RoleWithSshSchema.extend({
    orgName: z.string().openapi({
        description: "Name of the organization the role belongs to."
    })
});
