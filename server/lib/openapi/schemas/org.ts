import "@server/extendZod";
import { z } from "zod";

const retention = (what: string) =>
    z
        .number()
        .int()
        .openapi({
            description: `Days ${what} logs are kept before they are deleted. 0 or less disables deletion. 9001 keeps logs until the end of the following calendar year.`
        });

export const OrgSchema = z.object({
    orgId: z.string().openapi({ description: "ID of the organization." }),
    name: z.string().openapi({ description: "Organization name." }),
    subnet: z.string().nullable().openapi({
        description: "Subnet that site and client addresses are allocated from."
    }),
    utilitySubnet: z.string().nullable().openapi({
        description: "Subnet used for utility addresses such as aliases."
    }),
    createdAt: z.string().nullable().openapi({
        description: "ISO timestamp when the organization was created."
    }),
    requireTwoFactor: z.boolean().nullable().openapi({
        description:
            "Whether all members must have two-factor authentication enabled."
    }),
    maxSessionLengthHours: z.number().int().nullable().openapi({
        description: "Maximum session length in hours. Null means no limit."
    }),
    passwordExpiryDays: z.number().int().nullable().openapi({
        description:
            "Days before passwords expire. Null means they never expire."
    }),
    settingsLogRetentionDaysRequest: retention("request"),
    settingsLogRetentionDaysAccess: retention("access"),
    settingsLogRetentionDaysAction: retention("action"),
    settingsLogRetentionDaysConnection: retention("connection"),
    settingsLogRetentionDaysAISessions: retention("AI session"),
    settingsLogRetentionDaysSsh: retention("SSH"),
    sshCaPublicKey: z.string().nullable().openapi({
        description:
            "Public key of the organization's SSH certificate authority, to be trusted by SSH targets."
    }),
    isBillingOrg: z.boolean().nullable().openapi({
        description: "Whether this organization holds the billing account."
    }),
    billingOrgId: z.string().nullable().openapi({
        description: "ID of the organization that is billed for this one."
    }),
    settingsEnableGlobalNewtAutoUpdate: z.boolean().openapi({
        description:
            "Whether Newt agents in the organization update themselves automatically by default."
    }),
    settingsJitModeLimit: z.number().int().openapi({
        description: "Limit applied to just-in-time access mode."
    })
});
