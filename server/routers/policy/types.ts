import "@server/extendZod";
import { z } from "zod";
import { createSelectSchema } from "drizzle-zod";
import {
    resourceMtlsCertificates,
    resourcePolicies,
    resourcePolicyMtlsCertificates,
    resourcePolicyRules
} from "@server/db";

export const ResourcePolicyRuleSchema = createSelectSchema(
    resourcePolicyRules,
    {
        action: z
            .enum(["ACCEPT", "DROP", "PASS"])
            .openapi({ description: "What happens when the rule matches." }),
        enabled: (s) =>
            s.openapi({ description: "Whether the rule is evaluated." }),
        match: z
            .enum([
                "ASN",
                "CIDR",
                "COUNTRY",
                "COUNTRY_IS_NOT",
                "IP",
                "METHOD",
                "PATH",
                "REGION"
            ])
            .openapi({
                description: "What part of the request the rule matches on."
            }),
        priority: (s) =>
            s.openapi({
                description:
                    "Evaluation order. Rules with a lower number are evaluated first."
            }),
        ruleId: (s) => s.openapi({ description: "Numeric ID of the rule." }),
        value: (s) =>
            s.openapi({
                description: "Value to match, interpreted according to match."
            })
    }
);

export const ResourcePolicySchema = createSelectSchema(resourcePolicies, {
    applyRules: (s) =>
        s.openapi({
            description: "Whether the policy's access rules are evaluated."
        }),
    emailWhitelistEnabled: (s) =>
        s.openapi({
            description:
                "Whether access is limited to a list of one-time-password emails."
        }),
    idpId: (s) =>
        s.openapi({
            description:
                "ID of an identity provider users are sent to directly, skipping the login page."
        }),
    mtlsEnabled: (s) =>
        s.openapi({
            description:
                "Whether clients must present a certificate (mutual TLS)."
        }),
    name: (s) => s.openapi({ description: "Policy name." }),
    niceId: (s) =>
        s.openapi({
            description:
                "Human readable ID of the policy, unique within the organization."
        }),
    orgId: (s) =>
        s.openapi({
            description: "ID of the organization the policy belongs to."
        }),
    resourcePolicyId: (s) =>
        s.openapi({ description: "Numeric ID of the resource policy." }),
    scope: z.enum(["global", "resource"]).openapi({
        description:
            "global policies are shared and can be attached to many resources. resource policies are the inline policy of a single resource."
    }),
    sso: (s) =>
        s.openapi({
            description: "Whether users must sign in with the platform."
        })
});

export const MtlsCertificateInfoSchema = createSelectSchema(
    resourcePolicyMtlsCertificates,
    {
        createdAt: (s) =>
            s.openapi({
                description:
                    "Epoch milliseconds when the certificate was added."
            }),
        fingerprint: (s) =>
            s.openapi({
                description: "SHA-256 fingerprint of the certificate."
            }),
        issuer: (s) => s.openapi({ description: "Issuer of the certificate." }),
        mtlsCertificateId: (s) =>
            s.openapi({ description: "Numeric ID of the CA certificate." }),
        name: (s) =>
            s.openapi({ description: "Name given to the certificate." }),
        notAfter: (s) =>
            s.openapi({
                description:
                    "Epoch milliseconds after which the certificate is not valid."
            }),
        notBefore: (s) =>
            s.openapi({
                description:
                    "Epoch milliseconds before which the certificate is not valid."
            }),
        serialNumber: (s) =>
            s.openapi({ description: "Serial number of the certificate." }),
        subject: (s) =>
            s.openapi({ description: "Subject of the certificate." })
    }
).omit({ certificate: true, resourcePolicyId: true });

export const ResourceMtlsCertificateSchema = createSelectSchema(
    resourceMtlsCertificates,
    {
        createdAt: (s) =>
            s.openapi({
                description:
                    "Epoch milliseconds when the certificate was added."
            }),
        fingerprint: (s) =>
            s.openapi({
                description: "SHA-256 fingerprint of the certificate."
            }),
        issuer: (s) => s.openapi({ description: "Issuer of the certificate." }),
        mtlsCertificateId: (s) =>
            s.openapi({ description: "Numeric ID of the CA certificate." }),
        name: (s) =>
            s.openapi({ description: "Name given to the certificate." }),
        notAfter: (s) =>
            s.openapi({
                description:
                    "Epoch milliseconds after which the certificate is not valid."
            }),
        notBefore: (s) =>
            s.openapi({
                description:
                    "Epoch milliseconds before which the certificate is not valid."
            }),
        resourceId: (s) =>
            s.openapi({
                description: "ID of the resource the certificate was added to."
            }),
        serialNumber: (s) =>
            s.openapi({ description: "Serial number of the certificate." }),
        subject: (s) =>
            s.openapi({ description: "Subject of the certificate." })
    }
).omit({ certificate: true });

export const MtlsDisabledSchema = z.object({
    mtlsDisabled: z.boolean().openapi({
        description:
            "True when removing the last CA certificate forced mutual TLS off."
    })
});

export const ResourcePolicyDetailSchema = ResourcePolicySchema.pick({
    resourcePolicyId: true,
    niceId: true,
    name: true,
    sso: true,
    applyRules: true,
    emailWhitelistEnabled: true,
    mtlsEnabled: true,
    idpId: true
}).extend({
    passwordId: z.number().int().nullable().openapi({
        description: "ID of the password set on the policy, if any."
    }),
    pincodeId: z.number().int().nullable().openapi({
        description: "ID of the PIN code set on the policy, if any."
    }),
    headerAuth: z
        .object({
            id: z.number().int().openapi({
                description: "ID of the header authentication credential."
            }),
            extendedCompability: z.boolean().openapi({
                description:
                    "Whether the extended compatibility mode is on for header authentication."
            })
        })
        .nullable()
        .openapi({
            description:
                "Header authentication set on the policy. Null when none is set."
        }),
    roles: z
        .array(
            z.object({
                roleId: z
                    .number()
                    .int()
                    .openapi({ description: "Numeric ID of the role." }),
                name: z.string().openapi({ description: "Role name." })
            })
        )
        .openapi({
            description: "Roles that can access resources using this policy."
        }),
    users: z
        .array(
            z.object({
                userId: z.string().openapi({ description: "ID of the user." }),
                email: z
                    .string()
                    .nullable()
                    .openapi({ description: "Email of the user." }),
                name: z
                    .string()
                    .nullable()
                    .openapi({ description: "Name of the user." }),
                username: z
                    .string()
                    .openapi({ description: "Username of the user." }),
                type: z
                    .string()
                    .openapi({ description: "Sign-in type of the user." }),
                idpName: z.string().nullable().openapi({
                    description: "Name of the user's identity provider."
                })
            })
        )
        .openapi({
            description: "Users that can access resources using this policy."
        }),
    emailWhiteList: z
        .array(
            z.object({
                whiteListId: z.number().int().openapi({
                    description: "Numeric ID of the whitelist entry."
                }),
                email: z.string().openapi({
                    description:
                        "Email address allowed to sign in with a one-time password."
                })
            })
        )
        .openapi({
            description: "Emails allowed to sign in with a one-time password."
        }),
    rules: z
        .array(ResourcePolicyRuleSchema.omit({ resourcePolicyId: true }))
        .openapi({
            description: "Access rules of the policy."
        })
});
