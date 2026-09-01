import { z } from "zod";
import { existsSync } from "node:fs";
import { portRangeStringSchema } from "@server/lib/ip";
import { MaintenanceSchema } from "#dynamic/lib/blueprints/MaintenanceSchema";
import { isValidRegionId } from "@server/db/regions";
import { wildcardSubdomainSchema } from "@server/lib/schemas";
import config from "@server/lib/config";
import {
    aiBudgetEnforcementSchema,
    aiBudgetPeriodSchema,
    aiBudgetUnitSchema
} from "@server/routers/aiBudget/validation";

const maxmindDbPath = config.getRawConfig().server.maxmind_db_path;
const maxmindAsnPath = config.getRawConfig().server.maxmind_asn_path;

const hasMaxmindCountryDb =
    typeof maxmindDbPath === "string" &&
    maxmindDbPath.length > 0 &&
    existsSync(maxmindDbPath);

const hasMaxmindAsnDb =
    typeof maxmindAsnPath === "string" &&
    maxmindAsnPath.length > 0 &&
    existsSync(maxmindAsnPath);

export const SiteSchema = z.object({
    name: z.string().min(1).max(100),
    "docker-socket-enabled": z.boolean().optional().default(true)
});

export const TargetHealthCheckSchema = z.object({
    hostname: z.string(),
    port: z.int().min(1).max(65535),
    enabled: z.boolean().optional().default(true),
    path: z.string().optional().default("/"),
    scheme: z.string().optional(),
    mode: z.string().default("http"),
    interval: z.int().default(30),
    "unhealthy-interval": z.int().default(30),
    unhealthyInterval: z.int().optional(), // deprecated alias
    timeout: z.int().default(5),
    headers: z
        .array(z.object({ name: z.string(), value: z.string() }))
        .nullable()
        .optional()
        .default(null),
    "follow-redirects": z.boolean().default(true),
    followRedirects: z.boolean().optional(), // deprecated alias
    method: z.string().optional(),
    status: z.int().optional(),
    "healthy-threshold": z.int().min(1).optional().default(1),
    "unhealthy-threshold": z.int().min(1).optional().default(1)
});

// Schema for individual target within a resource
export const TargetSchema = z.object({
    site: z.string().optional(),
    method: z.enum(["http", "https", "h2c"]).optional(),
    hostname: z.string(),
    port: z.int().min(1).max(65535),
    enabled: z.boolean().optional().default(true),
    "internal-port": z.int().min(1).max(65535).optional(),
    path: z.string().optional(),
    "path-match": z.enum(["exact", "prefix", "regex"]).optional().nullable(),
    healthcheck: TargetHealthCheckSchema.optional(),
    rewritePath: z.string().optional(), // deprecated alias
    "rewrite-path": z.string().optional(),
    "rewrite-match": z
        .enum(["exact", "prefix", "regex", "stripPrefix"])
        .optional()
        .nullable(),
    priority: z.int().min(1).max(1000).optional().default(100)
});
export type TargetData = z.infer<typeof TargetSchema>;

export const AuthSchema = z.object({
    // pincode has to have 6 digits
    pincode: z.number().min(100000).max(999999).optional(),
    password: z.string().min(1).optional(),
    "basic-auth": z
        .object({
            user: z.string().min(1),
            password: z.string().min(1),
            extendedCompatibility: z.boolean().default(true)
        })
        .optional(),
    "sso-enabled": z.boolean().optional().default(false),
    "sso-roles": z
        .array(z.string())
        .optional()
        .default([])
        .refine((roles) => !roles.includes("Admin"), {
            error: "Admin role cannot be included in sso-roles"
        }),
    "sso-users": z.array(z.string()).optional().default([]),
    "whitelist-users": z.array(z.email()).optional().default([]),
    "auto-login-idp": z.int().positive().optional()
});

export const RuleSchema = z
    .object({
        action: z.enum(["allow", "deny", "pass"]),
        match: z.enum(["cidr", "path", "ip", "country", "country_is_not", "asn", "region"]),
        value: z.coerce.string(),
        priority: z.int().optional(),
        enabled: z.boolean().optional().default(true)
    })
    .refine(
        (rule) => {
            if (rule.match === "ip") {
                // Check if it's a valid IP address (v4 or v6)
                return z.union([z.ipv4(), z.ipv6()]).safeParse(rule.value)
                    .success;
            }
            return true;
        },
        {
            path: ["value"],
            message: "Value must be a valid IP address when match is 'ip'"
        }
    )
    .refine(
        (rule) => {
            if (rule.match === "cidr") {
                // Check if it's a valid CIDR (v4 or v6)
                return z.union([z.cidrv4(), z.cidrv6()]).safeParse(rule.value)
                    .success;
            }
            return true;
        },
        {
            path: ["value"],
            message: "Value must be a valid CIDR notation when match is 'cidr'"
        }
    )
    .refine(
        (rule) => {
            if (rule.match === "country" || rule.match === "country_is_not") {
                if (!hasMaxmindCountryDb) {
                    return false;
                }
                // Check if it's a valid 2-letter country code or "ALL"
                return /^[A-Z]{2}$/.test(rule.value) || rule.value === "ALL";
            }
            return true;
        },
        {
            path: ["value"],
            message:
                "Country rules require a valid existing server.maxmind_db_path and value must be a 2-letter country code or 'ALL'"
        }
    )
    .refine(
        (rule) => {
            if (rule.match === "asn") {
                if (!hasMaxmindCountryDb || !hasMaxmindAsnDb) {
                    return false;
                }
                // Check if it's either AS<number> format or "ALL"
                const asNumberPattern = /^AS\d+$/i;
                return asNumberPattern.test(rule.value) || rule.value === "ALL";
            }
            return true;
        },
        {
            path: ["value"],
            message:
                "ASN rules require valid existing server.maxmind_db_path and server.maxmind_asn_path, and value must be 'AS<number>' format or 'ALL'"
        }
    )
    .refine(
        (rule) => {
            if (rule.match === "region") {
                return isValidRegionId(rule.value);
            }
            return true;
        },
        {
            path: ["value"],
            message:
                "Value must be a valid UN M.49 region or subregion ID when match is 'region'"
        }
    );

export const HeaderSchema = z.object({
    name: z.string().min(1),
    value: z.string().min(1)
});

export const AiProviderAttachmentSchema = z
    .object({
        provider: z.string().min(1),
        "access-mode": z
            .enum(["inherit", "select"])
            .optional()
            .default("inherit"),
        enabled: z.boolean().optional().default(true),
        models: z.array(z.string()).optional().default([])
    })
    .refine(
        (provider) => {
            if (provider.models.length === 0) {
                return true;
            }
            return provider["access-mode"] === "select";
        },
        {
            path: ["models"],
            error: "'models' can only be set on a provider with access-mode 'select'"
        }
    );

export const AiBudgetSchema = z.object({
    amount: z.number().positive(),
    unit: aiBudgetUnitSchema,
    period: aiBudgetPeriodSchema.optional().default("monthly"),
    enforcement: aiBudgetEnforcementSchema.optional().default("hard"),
    enabled: z.boolean().optional().default(true)
});

const aiBudgetArraySchema = z.array(AiBudgetSchema).refine(
    (budgets) => {
        const keys = budgets.map((b) => `${b.unit}::${b.period}`);
        return keys.length === new Set(keys).size;
    },
    {
        message:
            "'ai-budget' entries must not overlap: only one budget per unit/period combination is allowed"
    }
);

// No default here: an object with only 'targets' set must remain
// recognized as a targets-only resource by isTargetsOnlyResource().
export const AiBudgetListSchema = aiBudgetArraySchema.optional();

export const AiBudgetListSchemaWithDefault = aiBudgetArraySchema
    .optional()
    .default([]);

export const AuthDaemonSchema = z
    .object({
        pam: z.enum(["passthrough", "push"]).optional().default("passthrough"),
        mode: z.enum(["site", "remote", "native"]).optional().default("site"),
        port: z.int().min(1).max(65535).optional()
    })
    .refine(
        (data) => {
            if (data.mode === "remote") {
                return data.port !== undefined;
            }
            return true;
        },
        {
            path: ["port"],
            message: "port is required when auth-daemon mode is 'remote'"
        }
    );

// Schema for individual resource
export const PublicResourceSchema = z
    .object({
        name: z.string().optional(),
        protocol: z
            .enum(["http", "tcp", "udp", "ssh", "rdp", "vnc"])
            .optional(), // this was the old one and is now DEPRECATED in favor of the mode
        mode: z
            .enum(["http", "tcp", "udp", "ssh", "rdp", "vnc", "inference"])
            .optional(),
        policy: z.string().optional(),
        ssl: z.boolean().optional(),
        scheme: z.enum(["http", "https"]).optional(),
        "full-domain": z.string().optional(),
        "proxy-port": z.int().min(1).max(65535).optional(),
        enabled: z.boolean().optional(),
        targets: z.array(TargetSchema.nullable()).optional().default([]),
        auth: AuthSchema.optional(),
        "host-header": z.string().optional(),
        "tls-server-name": z.string().optional(),
        headers: z.array(HeaderSchema).optional(), // deprecated alias for requestHeaders
        requestHeaders: z.array(HeaderSchema).optional(),
        responseHeaders: z.array(HeaderSchema).optional(),
        rules: z.array(RuleSchema).optional(),
        maintenance: MaintenanceSchema.optional(),
        "auth-daemon": AuthDaemonSchema.optional(),
        "proxy-protocol": z.boolean().optional(),
        "proxy-protocol-version": z.int().min(1).optional(),
        labels: z.array(z.string().min(1)).optional(),
        "ai-providers": z.array(AiProviderAttachmentSchema).optional(),
        "ai-budget": AiBudgetListSchema
    })
    .refine(
        (resource) => {
            if (isTargetsOnlyResource(resource)) {
                return true;
            }

            // Otherwise, require name and protocol/mode for full resource definition
            return (
                resource.name !== undefined &&
                (resource.mode !== undefined || resource.protocol !== undefined)
            );
        },
        {
            path: ["name", "protocol"],
            error: "Resource must either be targets-only (only 'targets' field) or have both 'name' and 'protocol' fields at a minimum"
        }
    )
    .refine(
        (resource) => {
            if (isTargetsOnlyResource(resource)) {
                return true;
            }

            // If protocol/mode is http, all targets must have method field
            if ((resource.mode ?? resource.protocol) === "http") {
                return resource.targets.every(
                    (target) => target == null || target.method !== undefined
                );
            }
            return true;
        },
        {
            path: ["targets"],
            error: "When protocol is 'http', all targets must have a 'method' field"
        }
    )
    .refine(
        (resource) => {
            if (isTargetsOnlyResource(resource)) {
                return true;
            }

            // If protocol/mode is tcp or udp, no target should have method field
            const effectiveProtocol1 = resource.mode ?? resource.protocol;
            if (effectiveProtocol1 === "tcp" || effectiveProtocol1 === "udp") {
                return resource.targets.every(
                    (target) => target == null || target.method === undefined
                );
            }
            return true;
        },
        {
            path: ["targets"],
            error: "When protocol is 'tcp' or 'udp', targets must not have a 'method' field"
        }
    )
    .refine(
        (resource) => {
            if (isTargetsOnlyResource(resource)) {
                return true;
            }

            const effectiveProtocol = resource.mode ?? resource.protocol;
            if (effectiveProtocol !== "ssh") {
                return true;
            }

            const authDaemonMode = resource["auth-daemon"]?.mode;
            if (authDaemonMode !== "native" && authDaemonMode !== "site") {
                return true;
            }

            return (
                resource.targets.filter((target) => target != null).length <= 1
            );
        },
        {
            path: ["targets"],
            error: "When protocol is 'ssh' and auth-daemon mode is 'native' or 'site', only one target/site is allowed"
        }
    )
    .refine(
        (resource) => {
            if (isTargetsOnlyResource(resource)) {
                return true;
            }

            // If protocol/mode is http, ssh, rdp, vnc, or inference, it must have a full-domain
            const effectiveProtocol = resource.mode ?? resource.protocol;
            if (
                effectiveProtocol !== undefined &&
                ["http", "ssh", "rdp", "vnc", "inference"].includes(
                    effectiveProtocol
                )
            ) {
                return (
                    resource["full-domain"] !== undefined &&
                    resource["full-domain"].length > 0
                );
            }
            return true;
        },
        {
            path: ["full-domain"],
            error: "When protocol is 'http', 'ssh', 'rdp', 'vnc', or 'inference', a 'full-domain' must be provided"
        }
    )
    .refine(
        (resource) => {
            if (isTargetsOnlyResource(resource)) {
                return true;
            }

            const effectiveMode = resource.mode ?? resource.protocol;
            if (effectiveMode !== "inference") {
                return true;
            }

            return resource.targets.every((target) => target == null);
        },
        {
            path: ["targets"],
            error: "When mode is 'inference', 'targets' must not be provided"
        }
    )
    .refine(
        (resource) => {
            if (isTargetsOnlyResource(resource)) {
                return true;
            }

            const effectiveMode = resource.mode ?? resource.protocol;
            if (effectiveMode === "inference") {
                return true;
            }

            return (resource["ai-providers"]?.length ?? 0) === 0;
        },
        {
            path: ["ai-providers"],
            error: "'ai-providers' can only be set when mode is 'inference'"
        }
    )
    .refine(
        (resource) => {
            if (isTargetsOnlyResource(resource)) {
                return true;
            }

            // If protocol/mode is tcp or udp, it must have both proxy-port
            const effectiveProtocol2 = resource.mode ?? resource.protocol;
            if (effectiveProtocol2 === "tcp" || effectiveProtocol2 === "udp") {
                return resource["proxy-port"] !== undefined;
            }
            return true;
        },
        {
            path: ["proxy-port", "exit-node"],
            error: "When protocol is 'tcp' or 'udp', 'proxy-port' must be provided"
        }
    )
    .refine(
        (resource) => {
            // Skip validation for targets-only resources
            if (isTargetsOnlyResource(resource)) {
                return true;
            }

            // If protocol/mode is tcp or udp, it must not have auth
            const effectiveProtocol3 = resource.mode ?? resource.protocol;
            if (effectiveProtocol3 === "tcp" || effectiveProtocol3 === "udp") {
                return resource.auth === undefined;
            }
            return true;
        },
        {
            path: ["auth"],
            error: "When protocol is 'tcp' or 'udp', 'auth' must not be provided"
        }
    )
    .refine(
        (resource) => {
            // Skip validation for targets-only resources
            if (isTargetsOnlyResource(resource)) {
                return true;
            }
            // Skip validation if no rules are defined
            if (!resource.rules || resource.rules.length === 0) return true;

            const finalPriorities: number[] = [];
            let priorityCounter = 1;

            // Gather priorities, assigning auto-priorities where needed
            // following the logic from the backend implementation where
            // empty priorities are auto-assigned a value of 1 + index of rule
            for (const rule of resource.rules) {
                if (rule.priority !== undefined) {
                    finalPriorities.push(rule.priority);
                } else {
                    finalPriorities.push(priorityCounter);
                }
                priorityCounter++;
            }

            // Validate for duplicate priorities
            return finalPriorities.length === new Set(finalPriorities).size;
        },
        {
            path: ["rules"],
            message:
                "Rules have conflicting or invalid priorities (must be unique, including auto-assigned ones)"
        }
    )
    .refine(
        (resource) => {
            const fullDomain = resource["full-domain"];
            if (!fullDomain || !fullDomain.includes("*")) return true;

            // A wildcard full-domain must be of the form *.labels.basedomain
            // Extract the leftmost label(s) before the first non-wildcard segment.
            // e.g. "*.level1.example.com" → subdomain candidate is "*.level1"
            // We do this by finding the base domain: everything after the first
            // real (non-wildcard) dot-separated segment pair.
            //
            // Simple rule: split on ".", first token must be "*", rest must be
            // valid hostname labels, and there must be at least 2 remaining labels
            // (so the full domain has a real base domain).
            const parts = fullDomain.split(".");
            if (parts[0] !== "*") return false; // * must be the very first label
            if (parts.includes("*", 1)) return false; // no further wildcards
            if (parts.length < 3) return false; // need at least *.label.tld

            const labelRegex =
                /^[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?$|^[a-zA-Z0-9]$/;
            return parts.slice(1).every((label) => labelRegex.test(label));
        },
        {
            path: ["full-domain"],
            message:
                'Wildcard full-domain must have "*" as the leftmost label only, followed by at least two valid hostname labels (e.g. "*.example.com" or "*.level1.example.com"). Patterns like "*example.com" or "level2.*.example.com" are not supported.'
        }
    )
    .refine(
        (resource) => {
            const effectiveMode = resource.mode ?? resource.protocol;
            if (effectiveMode !== "tcp") {
                return (
                    resource["proxy-protocol"] === undefined &&
                    resource["proxy-protocol-version"] === undefined
                );
            }
            return true;
        },
        {
            path: ["proxy-protocol"],
            message:
                "'proxy-protocol' and 'proxy-protocol-version' can only be set when mode is 'tcp'"
        }
    )
    .transform((resource) => {
        // Normalize: prefer mode, fall back to protocol for backwards compatibility
        if (resource.mode === undefined && resource.protocol !== undefined) {
            resource.mode = resource.protocol;
        }
        return resource;
    });

export function isTargetsOnlyResource(resource: any): boolean {
    return Object.keys(resource).length === 1 && resource.targets;
}

export const PrivateResourceSchema = z
    .object({
        name: z.string().min(1).max(255),
        mode: z.enum(["host", "cidr", "http", "ssh", "inference"]),
        site: z.string().optional(), // DEPRECATED IN FAVOR OF sites
        sites: z.array(z.string()).optional().default([]),
        // protocol: z.enum(["tcp", "udp"]).optional(),
        // proxyPort: z.int().positive().optional(),
        "destination-port": z.int().positive().optional(),
        destination: z.string().min(1).optional(),
        enabled: z.boolean().default(true),
        "tcp-ports": portRangeStringSchema.optional().default("*"),
        "udp-ports": portRangeStringSchema.optional().default("*"),
        "disable-icmp": z.boolean().optional().default(false),
        "full-domain": z.string().optional(),
        ssl: z.boolean().optional(),
        scheme: z.enum(["http", "https"]).optional().nullable(),
        alias: z
            .string()
            .regex(
                /^(?:[a-zA-Z0-9*?](?:[a-zA-Z0-9*?-]{0,61}[a-zA-Z0-9*?])?\.)+[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?$/,
                "Alias must be a fully qualified domain name with optional wildcards (e.g., example.com, *.example.com, host-0?.example.internal)"
            )
            .optional(),
        roles: z
            .array(z.string())
            .optional()
            .default([])
            .refine((roles) => !roles.includes("Admin"), {
                error: "Admin role cannot be included in roles"
            }),
        users: z.array(z.string()).optional().default([]),
        machines: z.array(z.string()).optional().default([]),
        labels: z.array(z.string().min(1)).optional().default([]),
        "auth-daemon": AuthDaemonSchema.optional(),
        "ai-providers": z
            .array(AiProviderAttachmentSchema)
            .optional()
            .default([]),
        "ai-budget": AiBudgetListSchemaWithDefault
    })
    .refine(
        (data) => {
            // destination is optional only for ssh+native or inference; required for everything else
            const isNativeSSH =
                data.mode === "ssh" &&
                (data["auth-daemon"] === undefined ||
                    data["auth-daemon"].mode === "native");
            if (
                data.mode !== "inference" &&
                !isNativeSSH &&
                !data.destination
            ) {
                return false;
            }
            return true;
        },
        {
            path: ["destination"],
            message:
                "destination is required unless mode is 'ssh' with auth-daemon mode 'native', or mode is 'inference'"
        }
    )
    .refine(
        (data) => {
            if (data.mode === "inference") {
                return true;
            }
            return (data["ai-providers"]?.length ?? 0) === 0;
        },
        {
            path: ["ai-providers"],
            error: "'ai-providers' can only be set when mode is 'inference'"
        }
    )
    .refine(
        (data) => {
            if (data.mode === "host") {
                if (!data.destination) return true; // caught by the destination-required refine
                // Check if it's a valid IP address using zod (v4 or v6)
                const isValidIP = z
                    .union([z.ipv4(), z.ipv6()])
                    .safeParse(data.destination).success;

                if (isValidIP) {
                    return true;
                }

                // Check if it's a valid domain (hostname pattern, TLD not required)
                const domainRegex =
                    /^(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)*[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?$/;
                const isValidDomain = domainRegex.test(data.destination);
                const isValidAlias = data.alias && domainRegex.test(data.alias);

                return isValidDomain && isValidAlias; // require the alias to be set in the case of domain
            }
            return true;
        },
        {
            message:
                "Destination must be a valid IP address or valid domain AND alias is required"
        }
    )
    .refine(
        (data) => {
            if (data.mode === "cidr") {
                if (!data.destination) return true; // caught by the destination-required refine
                // Check if it's a valid CIDR (v4 or v6)
                const isValidCIDR = z
                    .union([z.cidrv4(), z.cidrv6()])
                    .safeParse(data.destination).success;
                return isValidCIDR;
            }
            return true;
        },
        {
            message: "Destination must be a valid CIDR notation for cidr mode"
        }
    )
    .refine(
        (data) => {
            if (data.mode !== "ssh") {
                return true;
            }

            const authDaemonMode = data["auth-daemon"]?.mode;
            if (authDaemonMode !== "native" && authDaemonMode !== "site") {
                return true;
            }

            const uniqueSites = new Set<string>();
            if (data.site) {
                uniqueSites.add(data.site);
            }
            for (const site of data.sites) {
                uniqueSites.add(site);
            }

            return uniqueSites.size <= 1;
        },
        {
            path: ["sites"],
            message:
                "When mode is 'ssh' and auth-daemon mode is 'native' or 'site', only one site/target is allowed"
        }
    )
    .transform((data) => {
        if (
            data.mode === "ssh" &&
            data.destination !== undefined &&
            data["destination-port"] === undefined
        ) {
            data["destination-port"] = 22;
        }
        return data;
    });

export const ResourcePolicyRuleSchema = RuleSchema;

export const ResourcePolicySchema = z.object({
    name: z.string().min(1).max(255),
    sso: z.boolean().optional().default(true),
    "auto-login-idp": z.int().positive().optional().nullable(),
    "sso-roles": z
        .array(z.string())
        .optional()
        .default([])
        .refine((roles) => !roles.includes("Admin"), {
            error: "Admin role cannot be included in sso-roles"
        }),
    "sso-users": z.array(z.string()).optional().default([]),
    password: z.string().min(4).max(100).optional().nullable(),
    pincode: z
        .string()
        .regex(/^\d{6}$/)
        .optional()
        .nullable(),
    "basic-auth": z
        .object({
            user: z.string().min(4).max(100),
            password: z.string().min(4).max(100),
            "extended-compatibility": z.boolean().default(true)
        })
        .optional()
        .nullable(),
    "email-whitelist-enabled": z.boolean().optional().default(false),
    "whitelist-users": z
        .array(
            z.email().or(
                z.string().regex(/^\*@[\w.-]+\.[a-zA-Z]{2,}$/, {
                    error: "Invalid email address. Wildcard (*) must be the entire local part."
                })
            )
        )
        .transform((v) => v.map((e) => e.toLowerCase()))
        .optional()
        .default([]),
    "apply-rules": z.boolean().optional().default(false),
    rules: z.array(ResourcePolicyRuleSchema).optional().default([])
});
export type ResourcePolicyData = z.infer<typeof ResourcePolicySchema>;

// Schema for the entire configuration object
export const ConfigSchema = z
    .object({
        "proxy-resources": z
            .record(z.string(), PublicResourceSchema)
            .optional()
            .prefault({}),
        "public-resources": z
            .record(z.string(), PublicResourceSchema)
            .optional()
            .prefault({}),
        "client-resources": z
            .record(z.string(), PrivateResourceSchema)
            .optional()
            .prefault({}),
        "private-resources": z
            .record(z.string(), PrivateResourceSchema)
            .optional()
            .prefault({}),
        "public-policies": z
            .record(z.string(), ResourcePolicySchema)
            .optional()
            .prefault({}),
        sites: z.record(z.string(), SiteSchema).optional().prefault({})
    })
    .transform((data) => {
        // Merge public-resources into proxy-resources
        if (data["public-resources"]) {
            data["proxy-resources"] = {
                ...data["proxy-resources"],
                ...data["public-resources"]
            };
            delete (data as any)["public-resources"];
        }

        // Merge private-resources into client-resources
        if (data["private-resources"]) {
            data["client-resources"] = {
                ...data["client-resources"],
                ...data["private-resources"]
            };
            delete (data as any)["private-resources"];
        }

        return data as {
            "proxy-resources": Record<
                string,
                z.infer<typeof PublicResourceSchema>
            >;
            "client-resources": Record<
                string,
                z.infer<typeof PrivateResourceSchema>
            >;
            "public-policies": Record<
                string,
                z.infer<typeof ResourcePolicySchema>
            >;
            sites: Record<string, z.infer<typeof SiteSchema>>;
        };
    })
    .superRefine((config, ctx) => {
        // Enforce the full-domain uniqueness across resources in the same stack
        const fullDomainMap = new Map<string, string[]>();

        Object.entries(config["proxy-resources"]).forEach(
            ([resourceKey, resource]) => {
                const fullDomain = resource["full-domain"];
                if (fullDomain) {
                    // Only process if full-domain is defined
                    if (!fullDomainMap.has(fullDomain)) {
                        fullDomainMap.set(fullDomain, []);
                    }
                    fullDomainMap.get(fullDomain)!.push(resourceKey);
                }
            }
        );

        const fullDomainDuplicates = Array.from(fullDomainMap.entries())
            .filter(([_, resourceKeys]) => resourceKeys.length > 1)
            .map(
                ([fullDomain, resourceKeys]) =>
                    `'${fullDomain}' used by resources: ${resourceKeys.join(", ")}`
            )
            .join("; ");

        if (fullDomainDuplicates.length !== 0) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                path: ["proxy-resources"],
                message: `Duplicate 'full-domain' values found: ${fullDomainDuplicates}`
            });
        }

        // Enforce the full-domain uniqueness across client-resources in the same stack
        const clientFullDomainMap = new Map<string, string[]>();

        Object.entries(config["client-resources"]).forEach(
            ([resourceKey, resource]) => {
                const fullDomain = resource["full-domain"];
                if (fullDomain) {
                    if (!clientFullDomainMap.has(fullDomain)) {
                        clientFullDomainMap.set(fullDomain, []);
                    }
                    clientFullDomainMap.get(fullDomain)!.push(resourceKey);
                }
            }
        );

        const clientFullDomainDuplicates = Array.from(
            clientFullDomainMap.entries()
        )
            .filter(([_, resourceKeys]) => resourceKeys.length > 1)
            .map(
                ([fullDomain, resourceKeys]) =>
                    `'${fullDomain}' used by resources: ${resourceKeys.join(", ")}`
            )
            .join("; ");

        if (clientFullDomainDuplicates.length !== 0) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                path: ["client-resources"],
                message: `Duplicate 'full-domain' values found: ${clientFullDomainDuplicates}`
            });
        }

        // Enforce proxy-port uniqueness within proxy-resources per protocol
        const protocolPortMap = new Map<string, string[]>();

        Object.entries(config["proxy-resources"]).forEach(
            ([resourceKey, resource]) => {
                const proxyPort = resource["proxy-port"];
                const protocol = resource.protocol;
                if (proxyPort !== undefined && protocol !== undefined) {
                    const key = `${protocol}:${proxyPort}`;
                    if (!protocolPortMap.has(key)) {
                        protocolPortMap.set(key, []);
                    }
                    protocolPortMap.get(key)!.push(resourceKey);
                }
            }
        );

        const portDuplicates = Array.from(protocolPortMap.entries())
            .filter(([_, resourceKeys]) => resourceKeys.length > 1)
            .map(([protocolPort, resourceKeys]) => {
                const [protocol, port] = protocolPort.split(":");
                return `${protocol.toUpperCase()} port ${port} used by proxy-resources: ${resourceKeys.join(", ")}`;
            })
            .join("; ");

        if (portDuplicates.length !== 0) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                path: ["proxy-resources"],
                message: `Duplicate 'proxy-port' values found in proxy-resources: ${portDuplicates}`
            });
        }

        // Enforce alias uniqueness within client-resources
        const aliasMap = new Map<string, string[]>();

        Object.entries(config["client-resources"]).forEach(
            ([resourceKey, resource]) => {
                const alias = resource.alias;
                if (alias !== undefined) {
                    if (!aliasMap.has(alias)) {
                        aliasMap.set(alias, []);
                    }
                    aliasMap.get(alias)!.push(resourceKey);
                }
            }
        );

        const aliasDuplicates = Array.from(aliasMap.entries())
            .filter(([_, resourceKeys]) => resourceKeys.length > 1)
            .map(
                ([alias, resourceKeys]) =>
                    `alias '${alias}' used by client-resources: ${resourceKeys.join(", ")}`
            )
            .join("; ");

        if (aliasDuplicates.length !== 0) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                path: ["client-resources"],
                message: `Duplicate 'alias' values found in client-resources: ${aliasDuplicates}`
            });
        }
    });

// Type inference from the schema
export type Site = z.infer<typeof SiteSchema>;
export type Target = z.infer<typeof TargetSchema>;
export type Resource = z.infer<typeof PublicResourceSchema>;
export type Config = z.infer<typeof ConfigSchema>;
export type BlueprintResourcePolicy = z.infer<typeof ResourcePolicySchema>;
export type BlueprintAiBudget = z.infer<typeof AiBudgetSchema>;
