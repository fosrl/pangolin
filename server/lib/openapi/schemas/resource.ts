import "@server/extendZod";
import { z } from "zod";

const headers = z
    .array(
        z.object({
            name: z.string().openapi({ description: "Header name." }),
            value: z.string().openapi({ description: "Header value." })
        })
    )
    .nullable();

const resourceFields = {
    resourceId: z.number().int().openapi({
        description: "Numeric ID of the public resource."
    }),
    niceId: z.string().openapi({
        description:
            "Human readable ID of the resource, unique within the organization."
    }),
    name: z.string().openapi({ description: "Resource name." }),
    ssl: z
        .boolean()
        .openapi({ description: "Whether the resource is served over HTTPS." }),
    fullDomain: z.string().nullable().openapi({
        description: "Full domain the resource is served on (http mode)."
    }),
    domainId: z.string().nullable().openapi({
        description: "ID of the domain the resource is served on (http mode)."
    }),
    proxyPort: z.number().int().nullable().openapi({
        description: "Public port the resource listens on (tcp and udp mode)."
    }),
    enabled: z.boolean().openapi({
        description: "Whether the resource currently accepts traffic."
    }),
    wildcard: z.boolean().openapi({
        description:
            "Whether the resource matches all subdomains of its domain."
    }),
    health: z.string().nullable().openapi({
        description: "Aggregate health of the resource's targets."
    })
};

export const ResourceSchema = z.object({
    ...resourceFields,
    orgId: z.string().openapi({
        description: "ID of the organization the resource belongs to."
    }),
    resourceGuid: z.string().openapi({
        description: "Globally unique ID of the resource."
    }),
    mode: z
        .enum(["http", "inference", "rdp", "ssh", "tcp", "udp", "vnc"])
        .openapi({
            description: "How the resource is exposed."
        }),
    subdomain: z.string().nullable().openapi({
        description: "Subdomain the resource is served on (http mode)."
    }),
    matchBaseDomain: z.boolean().openapi({
        description:
            "Whether the resource is served on the bare domain instead of a subdomain."
    }),
    status: z.enum(["approved", "pending"]).nullable().openapi({
        description: "Approval state of the resource."
    }),
    sso: z.boolean().nullable().openapi({
        description:
            "Whether users must sign in with the platform to access the resource."
    }),
    blockAccess: z.boolean().openapi({
        description: "Whether all access to the resource is blocked."
    }),
    emailWhitelistEnabled: z.boolean().nullable().openapi({
        description:
            "Whether access is limited to a list of one-time-password emails."
    }),
    applyRules: z.boolean().nullable().openapi({
        description: "Whether the resource's access rules are evaluated."
    }),
    skipToIdpId: z.number().int().nullable().openapi({
        description:
            "ID of an identity provider that users are sent to directly, skipping the login page."
    }),
    enableProxy: z.boolean().nullable().openapi({
        description: "Whether traffic is proxied through the exit node."
    }),
    forwardIdentityHeaders: z.boolean().openapi({
        description:
            "Whether headers identifying the authenticated user are forwarded to the target."
    }),
    stickySession: z.boolean().openapi({
        description: "Whether a client keeps being routed to the same target."
    }),
    loadBalancingStrategy: z.enum(["hrw", "leasttime", "p2c", "wrr"]).openapi({
        description:
            "How requests are balanced across targets: highest random weight, least time, power of two choices or weighted round robin."
    }),
    tlsServerName: z.string().nullable().openapi({
        description: "TLS server name (SNI) used when connecting to targets."
    }),
    setHostHeader: z.string().nullable().openapi({
        description: "Host header sent to targets instead of the original one."
    }),
    postAuthPath: z.string().nullable().openapi({
        description: "Path users are sent to after they authenticate."
    }),
    proxyProtocol: z.boolean().openapi({
        description: "Whether the PROXY protocol is used for raw TCP resources."
    }),
    proxyProtocolVersion: z.number().int().nullable().openapi({
        description: "PROXY protocol version used when proxyProtocol is on."
    }),
    mtlsEnabled: z.boolean().openapi({
        description: "Whether clients must present a certificate (mutual TLS)."
    }),
    requestHeaders: z.string().nullable().openapi({
        description:
            "Headers added to requests to the target, as a JSON string."
    }),
    responseHeaders: z.string().nullable().openapi({
        description:
            "Headers added to responses to the client, as a JSON string."
    }),
    resourcePolicyId: z.number().int().nullable().openapi({
        description: "ID of the shared access policy applied to the resource."
    }),
    defaultResourcePolicyId: z.number().int().nullable().openapi({
        description: "ID of the resource's own inline access policy."
    }),
    maintenanceModeEnabled: z.boolean().openapi({
        description:
            "Whether the maintenance page is shown instead of the resource."
    }),
    maintenanceModeType: z.enum(["automatic", "forced"]).nullable().openapi({
        description:
            "automatic shows the maintenance page only when all targets are down. forced always shows it."
    }),
    maintenanceTitle: z.string().nullable().openapi({
        description: "Title of the maintenance page."
    }),
    maintenanceMessage: z.string().nullable().openapi({
        description: "Message of the maintenance page."
    }),
    maintenanceEstimatedTime: z.string().nullable().openapi({
        description:
            "Estimated time the maintenance ends, shown on the maintenance page."
    }),
    authDaemonPort: z.number().int().nullable().openapi({
        description: "Port the SSH auth daemon listens on (ssh mode)."
    }),
    authDaemonMode: z.enum(["native", "remote", "site"]).nullable().openapi({
        description: "Where the SSH auth daemon runs (ssh mode)."
    }),
    pamMode: z.enum(["passthrough", "push"]).nullable().openapi({
        description: "How SSH authentication is handled (ssh mode)."
    })
});

export const ResourceDetailSchema = ResourceSchema.omit({
    requestHeaders: true,
    responseHeaders: true
}).extend({
    requestHeaders: headers.openapi({
        description: "Headers added to requests to the target."
    }),
    responseHeaders: headers.openapi({
        description: "Headers added to responses to the client."
    })
});

export const ResourceListItemSchema = z.object({
    ...resourceFields,
    mode: z
        .string()
        .nullable()
        .openapi({ description: "How the resource is exposed." }),
    passwordId: z.number().int().nullable().openapi({
        description:
            "ID of the password the resource is protected with, if any."
    }),
    pincodeId: z.number().int().nullable().openapi({
        description:
            "ID of the PIN code the resource is protected with, if any."
    }),
    headerAuthId: z.number().int().nullable().openapi({
        description: "ID of the header authentication credential, if any."
    }),
    sso: z.boolean().openapi({
        description:
            "Whether users must sign in with the platform to access the resource."
    }),
    whitelist: z.boolean().openapi({
        description:
            "Whether access is limited to a list of one-time-password emails."
    }),
    mtls: z.boolean().openapi({
        description: "Whether clients must present a certificate (mutual TLS)."
    }),
    targets: z
        .array(
            z.object({
                targetId: z
                    .number()
                    .int()
                    .openapi({ description: "Numeric ID of the target." }),
                ip: z.string().openapi({
                    description: "IP address or hostname of the target."
                }),
                port: z
                    .number()
                    .int()
                    .openapi({ description: "Port of the target." }),
                enabled: z.boolean().openapi({
                    description: "Whether the target receives traffic."
                }),
                healthStatus: z
                    .enum(["healthy", "unhealthy", "unknown"])
                    .nullable()
                    .openapi({
                        description: "Current health of the target."
                    }),
                siteName: z.string().nullable().openapi({
                    description: "Name of the site that connects to the target."
                })
            })
        )
        .openapi({ description: "Targets of the resource." }),
    sites: z
        .array(
            z.object({
                siteId: z
                    .number()
                    .int()
                    .openapi({ description: "Numeric ID of the site." }),
                siteName: z.string().openapi({ description: "Site name." }),
                siteNiceId: z
                    .string()
                    .openapi({ description: "Human readable ID of the site." }),
                online: z.boolean().optional().openapi({
                    description:
                        "Whether the site is connected. Not set for local sites."
                })
            })
        )
        .openapi({ description: "Sites that serve the resource's targets." }),
    labels: z
        .array(
            z.object({
                labelId: z
                    .number()
                    .int()
                    .openapi({ description: "Numeric ID of the label." }),
                name: z.string().openapi({ description: "Label name." }),
                color: z.string().openapi({ description: "Label color." })
            })
        )
        .optional()
        .openapi({ description: "Labels attached to the resource." })
});

export const ResourceNameSchema = z.object({
    resourceId: resourceFields.resourceId,
    name: resourceFields.name
});

const ruleMatch = z.enum([
    "ASN",
    "CIDR",
    "COUNTRY",
    "COUNTRY_IS_NOT",
    "IP",
    "METHOD",
    "PATH",
    "REGION"
]);

export const ResourceRuleSchema = z.object({
    ruleId: z
        .number()
        .int()
        .openapi({ description: "Numeric ID of the rule." }),
    resourceId: z.number().int().openapi({
        description: "ID of the resource the rule belongs to."
    }),
    enabled: z
        .boolean()
        .openapi({ description: "Whether the rule is evaluated." }),
    priority: z.number().int().openapi({
        description:
            "Evaluation order. Rules with a lower number are evaluated first."
    }),
    action: z.string().openapi({
        description: "What happens when the rule matches: ACCEPT, DROP or PASS."
    }),
    match: ruleMatch.openapi({
        description: "What part of the request the rule matches on."
    }),
    value: z.string().openapi({
        description: "Value to match, interpreted according to match."
    })
});

export const ResourceRuleListItemSchema = ResourceRuleSchema;
