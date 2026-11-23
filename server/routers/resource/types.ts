import "@server/extendZod";
import { PaginationSchema } from "@server/lib/openapi/pagination";
import {
    ResourcePolicySchema,
    MtlsDisabledSchema,
    ResourceMtlsCertificateSchema
} from "@server/routers/policy/types";
import { z } from "zod";
import { createSelectSchema } from "drizzle-zod";
import { resourceRules, resources } from "@server/db";

export type GetMaintenanceInfoResponse = {
    resourceId: number;
    name: string;
    fullDomain: string | null;
    maintenanceModeEnabled: boolean;
    maintenanceModeType: "forced" | "automatic" | null;
    maintenanceTitle: string | null;
    maintenanceMessage: string | null;
    maintenanceEstimatedTime: string | null;
};

export const ResourceSchema = createSelectSchema(resources, {
    applyRules: (s) =>
        s.openapi({
            description: "Whether the resource's access rules are evaluated."
        }),
    authDaemonMode: z
        .enum(["native", "remote", "site"])
        .nullable()
        .openapi({ description: "Where the SSH auth daemon runs (ssh mode)." }),
    authDaemonPort: (s) =>
        s.openapi({
            description: "Port the SSH auth daemon listens on (ssh mode)."
        }),
    blockAccess: (s) =>
        s.openapi({
            description: "Whether all access to the resource is blocked."
        }),
    defaultResourcePolicyId: (s) =>
        s.openapi({
            description: "ID of the resource's own inline access policy."
        }),
    domainId: (s) =>
        s.openapi({
            description:
                "ID of the domain the resource is served on (http mode)."
        }),
    emailWhitelistEnabled: (s) =>
        s.openapi({
            description:
                "Whether access is limited to a list of one-time-password emails."
        }),
    enableProxy: (s) =>
        s.openapi({
            description: "Whether traffic is proxied through the exit node."
        }),
    enabled: (s) =>
        s.openapi({
            description: "Whether the resource currently accepts traffic."
        }),
    forwardIdentityHeaders: (s) =>
        s.openapi({
            description:
                "Whether headers identifying the authenticated user are forwarded to the target."
        }),
    fullDomain: (s) =>
        s.openapi({
            description: "Full domain the resource is served on (http mode)."
        }),
    health: (s) =>
        s.openapi({
            description: "Aggregate health of the resource's targets."
        }),
    loadBalancingStrategy: z.enum(["hrw", "leasttime", "p2c", "wrr"]).openapi({
        description:
            "How requests are balanced across targets: highest random weight, least time, power of two choices or weighted round robin."
    }),
    maintenanceEstimatedTime: (s) =>
        s.openapi({
            description:
                "Estimated time the maintenance ends, shown on the maintenance page."
        }),
    maintenanceMessage: (s) =>
        s.openapi({ description: "Message of the maintenance page." }),
    maintenanceModeEnabled: (s) =>
        s.openapi({
            description:
                "Whether the maintenance page is shown instead of the resource."
        }),
    maintenanceModeType: z.enum(["automatic", "forced"]).nullable().openapi({
        description:
            "automatic shows the maintenance page only when all targets are down. forced always shows it."
    }),
    maintenanceTitle: (s) =>
        s.openapi({ description: "Title of the maintenance page." }),
    matchBaseDomain: (s) =>
        s.openapi({
            description:
                "Whether the resource is served on the bare domain instead of a subdomain."
        }),
    mode: z
        .enum(["http", "inference", "rdp", "ssh", "tcp", "udp", "vnc"])
        .openapi({ description: "How the resource is exposed." }),
    mtlsEnabled: (s) =>
        s.openapi({
            description:
                "Whether clients must present a certificate (mutual TLS)."
        }),
    name: (s) => s.openapi({ description: "Resource name." }),
    niceId: (s) =>
        s.openapi({
            description:
                "Human readable ID of the resource, unique within the organization."
        }),
    orgId: (s) =>
        s.openapi({
            description: "ID of the organization the resource belongs to."
        }),
    pamMode: z.enum(["passthrough", "push"]).nullable().openapi({
        description: "How SSH authentication is handled (ssh mode)."
    }),
    postAuthPath: (s) =>
        s.openapi({
            description: "Path users are sent to after they authenticate."
        }),
    proxyPort: (s) =>
        s.openapi({
            description:
                "Public port the resource listens on (tcp and udp mode)."
        }),
    proxyProtocol: (s) =>
        s.openapi({
            description:
                "Whether the PROXY protocol is used for raw TCP resources."
        }),
    proxyProtocolVersion: (s) =>
        s.openapi({
            description: "PROXY protocol version used when proxyProtocol is on."
        }),
    requestHeaders: (s) =>
        s.openapi({
            description:
                "Headers added to requests to the target, as a JSON string."
        }),
    resourceGuid: (s) =>
        s.openapi({ description: "Globally unique ID of the resource." }),
    resourceId: (s) =>
        s.openapi({ description: "Numeric ID of the public resource." }),
    resourcePolicyId: (s) =>
        s.openapi({
            description:
                "ID of the shared access policy applied to the resource."
        }),
    responseHeaders: (s) =>
        s.openapi({
            description:
                "Headers added to responses to the client, as a JSON string."
        }),
    setHostHeader: (s) =>
        s.openapi({
            description:
                "Host header sent to targets instead of the original one."
        }),
    skipToIdpId: (s) =>
        s.openapi({
            description:
                "ID of an identity provider that users are sent to directly, skipping the login page."
        }),
    ssl: (s) =>
        s.openapi({
            description: "Whether the resource is served over HTTPS."
        }),
    sso: (s) =>
        s.openapi({
            description:
                "Whether users must sign in with the platform to access the resource."
        }),
    status: z
        .enum(["approved", "pending"])
        .nullable()
        .openapi({ description: "Approval state of the resource." }),
    stickySession: (s) =>
        s.openapi({
            description:
                "Whether a client keeps being routed to the same target."
        }),
    subdomain: (s) =>
        s.openapi({
            description: "Subdomain the resource is served on (http mode)."
        }),
    tlsServerName: (s) =>
        s.openapi({
            description:
                "TLS server name (SNI) used when connecting to targets."
        }),
    wildcard: (s) =>
        s.openapi({
            description:
                "Whether the resource matches all subdomains of its domain."
        })
});

export const ResourceRuleSchema = createSelectSchema(resourceRules, {
    action: (s) =>
        s.openapi({
            description:
                "What happens when the rule matches: ACCEPT, DROP or PASS."
        }),
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
    resourceId: (s) =>
        s.openapi({ description: "ID of the resource the rule belongs to." }),
    ruleId: (s) => s.openapi({ description: "Numeric ID of the rule." }),
    value: (s) =>
        s.openapi({
            description: "Value to match, interpreted according to match."
        })
});

export const AttachedResourceSchema = ResourceSchema.pick({
    resourceId: true,
    niceId: true,
    name: true,
    fullDomain: true
});
export type AttachedResource = z.infer<typeof AttachedResourceSchema>;

export const ResourcePolicyWithResourcesSchema = ResourcePolicySchema.pick({
    resourcePolicyId: true,
    niceId: true,
    name: true,
    orgId: true
}).extend({
    resources: z.array(AttachedResourceSchema).openapi({
        description: "Resources this policy is attached to."
    })
});
export type ResourcePolicyWithResources = z.infer<
    typeof ResourcePolicyWithResourcesSchema
>;

export const ListResourcePoliciesResponseDataSchema = z.object({
    policies: z.array(ResourcePolicyWithResourcesSchema),
    pagination: PaginationSchema
});
export type ListResourcePoliciesResponse = z.infer<
    typeof ListResourcePoliciesResponseDataSchema
>;

export const DeleteResourceMtlsCertificateResponseDataSchema =
    MtlsDisabledSchema;
export type DeleteResourceMtlsCertificateResponse = z.infer<
    typeof DeleteResourceMtlsCertificateResponseDataSchema
>;

export const CreateResourceMtlsCertificateResponseDataSchema = z.object({
    certificates: z.array(ResourceMtlsCertificateSchema)
});
export type CreateResourceMtlsCertificateResponse = z.infer<
    typeof CreateResourceMtlsCertificateResponseDataSchema
>;

export const ListResourceMtlsCertificatesResponseDataSchema = z.object({
    certificates: z.array(ResourceMtlsCertificateSchema)
});
export type ListResourceMtlsCertificatesResponse = z.infer<
    typeof ListResourceMtlsCertificatesResponseDataSchema
>;
