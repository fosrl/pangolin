import "@server/extendZod";
import { z } from "zod";
import { createSelectSchema } from "drizzle-zod";
import { orgs } from "@server/db";

export const OrgSchema = createSelectSchema(orgs, {
    billingOrgId: (s) =>
        s.openapi({
            description: "ID of the organization that is billed for this one."
        }),
    createdAt: (s) =>
        s.openapi({
            description: "ISO timestamp when the organization was created."
        }),
    isBillingOrg: (s) =>
        s.openapi({
            description: "Whether this organization holds the billing account."
        }),
    maxSessionLengthHours: (s) =>
        s.openapi({
            description: "Maximum session length in hours. Null means no limit."
        }),
    name: (s) => s.openapi({ description: "Organization name." }),
    orgId: (s) => s.openapi({ description: "ID of the organization." }),
    passwordExpiryDays: (s) =>
        s.openapi({
            description:
                "Days before passwords expire. Null means they never expire."
        }),
    requireTwoFactor: (s) =>
        s.openapi({
            description:
                "Whether all members must have two-factor authentication enabled."
        }),
    settingsEnableGlobalNewtAutoUpdate: (s) =>
        s.openapi({
            description:
                "Whether Newt agents in the organization update themselves automatically by default."
        }),
    settingsJitModeLimit: (s) =>
        s.openapi({
            description: "Limit applied to just-in-time access mode."
        }),
    sshCaPublicKey: (s) =>
        s.openapi({
            description:
                "Public key of the organization's SSH certificate authority, to be trusted by SSH targets."
        }),
    subnet: (s) =>
        s.openapi({
            description:
                "Subnet that site and client addresses are allocated from."
        }),
    utilitySubnet: (s) =>
        s.openapi({
            description: "Subnet used for utility addresses such as aliases."
        })
}).omit({ sshCaPrivateKey: true });
