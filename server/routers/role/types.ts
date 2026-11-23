import "@server/extendZod";
import { z } from "zod";
import { createSelectSchema } from "drizzle-zod";
import { roles } from "@server/db";
// The role's stored client settings, as edited on the role's page. Null means
// the setting isn't managed by the server.
export type RoleClientSettingsValues = {
    enabled: boolean;
    overrideDns: boolean | null;
    mtu: number | null;
    tunnelDns: boolean | null;
    primaryDns: string | null;
    secondaryDns: string | null;
    exitNodeTakesPrecedence: boolean | null;
    exitNodeSiteResourceId: number | null;
    exitNodeLocked: boolean;
    matchDomains: string[] | null;
    preferLocalRoutes: boolean | null;
};

export type GetRoleClientSettingsResponse = RoleClientSettingsValues;
export type UpdateRoleClientSettingsResponse = RoleClientSettingsValues;

export const RoleSchema = createSelectSchema(roles, {
    description: (s) => s.openapi({ description: "Role description." }),
    isAdmin: (s) =>
        s.openapi({
            description:
                "Whether this is the built-in admin role of the organization."
        }),
    name: (s) => s.openapi({ description: "Role name." }),
    orgId: (s) =>
        s.openapi({
            description: "ID of the organization the role belongs to."
        }),
    requireDeviceApproval: (s) =>
        s.openapi({
            description:
                "Whether clients owned by users with this role need admin approval before they can connect."
        }),
    roleId: (s) => s.openapi({ description: "Numeric ID of the role." }),
    sshCreateHomeDir: (s) =>
        s.openapi({
            description:
                "Whether a home directory is created for the user on first SSH login."
        }),
    sshSudoCommands: (s) =>
        s.openapi({
            description:
                "Commands users with this role may run with sudo when sshSudoMode is commands."
        }),
    sshSudoMode: (s) =>
        s.openapi({
            description:
                "Sudo access granted to users with this role on SSH resources: none, full or commands."
        }),
    sshUnixGroups: (s) =>
        s.openapi({
            description:
                "Unix groups users with this role are added to on SSH login."
        })
});

export const RoleSummarySchema = RoleSchema.pick({
    roleId: true,
    name: true,
    description: true,
    isAdmin: true
});
