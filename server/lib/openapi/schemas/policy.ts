import "@server/extendZod";
import { z } from "zod";

const mtlsFields = {
    mtlsCertificateId: z.number().int().openapi({
        description: "Numeric ID of the CA certificate."
    }),
    name: z
        .string()
        .nullable()
        .openapi({ description: "Name given to the certificate." }),
    subject: z
        .string()
        .nullable()
        .openapi({ description: "Subject of the certificate." }),
    issuer: z
        .string()
        .nullable()
        .openapi({ description: "Issuer of the certificate." }),
    serialNumber: z.string().nullable().openapi({
        description: "Serial number of the certificate."
    }),
    fingerprint: z.string().nullable().openapi({
        description: "SHA-256 fingerprint of the certificate."
    }),
    notBefore: z.number().int().nullable().openapi({
        description:
            "Epoch milliseconds before which the certificate is not valid."
    }),
    notAfter: z.number().int().nullable().openapi({
        description:
            "Epoch milliseconds after which the certificate is not valid."
    }),
    createdAt: z.number().int().openapi({
        description: "Epoch milliseconds when the certificate was added."
    })
};

export const MtlsCertificateInfoSchema = z.object(mtlsFields);

export const ResourceMtlsCertificateSchema = MtlsCertificateInfoSchema.extend({
    resourceId: z.number().int().openapi({
        description: "ID of the resource the certificate was added to."
    })
});

export const MtlsDisabledSchema = z.object({
    mtlsDisabled: z.boolean().openapi({
        description:
            "True when removing the last CA certificate forced mutual TLS off."
    })
});

const policyBase = {
    resourcePolicyId: z.number().int().openapi({
        description: "Numeric ID of the resource policy."
    }),
    niceId: z.string().openapi({
        description:
            "Human readable ID of the policy, unique within the organization."
    }),
    name: z.string().openapi({ description: "Policy name." })
};

export const ResourcePolicySchema = z.object({
    ...policyBase,
    orgId: z.string().openapi({
        description: "ID of the organization the policy belongs to."
    }),
    scope: z.enum(["global", "resource"]).openapi({
        description:
            "global policies are shared and can be attached to many resources. resource policies are the inline policy of a single resource."
    }),
    sso: z.boolean().openapi({
        description: "Whether users must sign in with the platform."
    }),
    applyRules: z.boolean().openapi({
        description: "Whether the policy's access rules are evaluated."
    }),
    emailWhitelistEnabled: z.boolean().openapi({
        description:
            "Whether access is limited to a list of one-time-password emails."
    }),
    mtlsEnabled: z.boolean().openapi({
        description: "Whether clients must present a certificate (mutual TLS)."
    }),
    idpId: z.number().int().nullable().openapi({
        description:
            "ID of an identity provider users are sent to directly, skipping the login page."
    })
});

const policyRuleSchema = z.object({
    ruleId: z
        .number()
        .int()
        .openapi({ description: "Numeric ID of the rule." }),
    enabled: z
        .boolean()
        .openapi({ description: "Whether the rule is evaluated." }),
    priority: z.number().int().openapi({
        description:
            "Evaluation order. Rules with a lower number are evaluated first."
    }),
    action: z.enum(["ACCEPT", "DROP", "PASS"]).openapi({
        description: "What happens when the rule matches."
    }),
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
    value: z.string().openapi({
        description: "Value to match, interpreted according to match."
    })
});

export const ResourcePolicyDetailSchema = z.object({
    ...policyBase,
    sso: ResourcePolicySchema.shape.sso,
    applyRules: ResourcePolicySchema.shape.applyRules,
    emailWhitelistEnabled: ResourcePolicySchema.shape.emailWhitelistEnabled,
    mtlsEnabled: ResourcePolicySchema.shape.mtlsEnabled,
    idpId: ResourcePolicySchema.shape.idpId,
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
    rules: z.array(policyRuleSchema).openapi({
        description: "Access rules of the policy."
    })
});

export const ResourcePoliciesOfResourceSchema = z.object({
    defaultPolicy: ResourcePolicyDetailSchema.openapi({
        description: "The resource's own inline policy."
    }),
    sharedPolicy: ResourcePolicyDetailSchema.nullable().openapi({
        description: "The shared policy attached to the resource, if any."
    })
});

export const ResourcePolicyListItemSchema = z.object({
    ...policyBase,
    orgId: ResourcePolicySchema.shape.orgId,
    resources: z
        .array(
            z.object({
                resourceId: z
                    .number()
                    .int()
                    .openapi({ description: "Numeric ID of the resource." }),
                niceId: z.string().openapi({
                    description: "Human readable ID of the resource."
                }),
                name: z.string().openapi({ description: "Resource name." }),
                fullDomain: z.string().nullable().openapi({
                    description: "Full domain the resource is served on."
                })
            })
        )
        .openapi({ description: "Resources this policy is attached to." })
});
