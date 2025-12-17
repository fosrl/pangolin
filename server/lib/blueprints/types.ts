import { z } from "zod";
import { portRangeStringSchema } from "@server/lib/ip";

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
    method: z.string().default("GET"),
    status: z.int().optional()
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
            password: z.string().min(1)
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
    "sso-users": z.array(z.email()).optional().default([]),
    "whitelist-users": z.array(z.email()).optional().default([]),
    "auto-login-idp": z.int().positive().optional()
});

export const RuleSchema = z.object({
    action: z.enum(["allow", "deny", "pass"]),
    match: z.enum(["cidr", "path", "ip", "country"]),
    value: z.string()
});

export const HeaderSchema = z.object({
    name: z.string().min(1),
    value: z.string().min(1)
});

// Schema for individual resource
export const ResourceSchema = z
    .object({
        name: z.string().optional(),
        protocol: z.enum(["http", "tcp", "udp"]).optional(),
        ssl: z.boolean().optional(),
        "full-domain": z.string().optional(),
        "proxy-port": z.int().min(1).max(65535).optional(),
        enabled: z.boolean().optional(),
        targets: z.array(TargetSchema.nullable()).optional().default([]),
        auth: AuthSchema.optional(),
        "host-header": z.string().optional(),
        "tls-server-name": z.string().optional(),
        headers: z.array(HeaderSchema).optional(),
        rules: z.array(RuleSchema).optional()
    })
    .refine(
        (resource) => {
            if (isTargetsOnlyResource(resource)) {
                return true;
            }

            // Otherwise, require name and protocol for full resource definition
            return (
                resource.name !== undefined && resource.protocol !== undefined
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

            // If protocol is http, all targets must have method field
            if (resource.protocol === "http") {
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

            // If protocol is tcp or udp, no target should have method field
            if (resource.protocol === "tcp" || resource.protocol === "udp") {
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

            // If protocol is http, it must have a full-domain
            if (resource.protocol === "http") {
                return (
                    resource["full-domain"] !== undefined &&
                    resource["full-domain"].length > 0
                );
            }
            return true;
        },
        {
            path: ["full-domain"],
            error: "When protocol is 'http', a 'full-domain' must be provided"
        }
    )
    .refine(
        (resource) => {
            if (isTargetsOnlyResource(resource)) {
                return true;
            }

            // If protocol is tcp or udp, it must have both proxy-port
            if (resource.protocol === "tcp" || resource.protocol === "udp") {
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

            // If protocol is tcp or udp, it must not have auth
            if (resource.protocol === "tcp" || resource.protocol === "udp") {
                return resource.auth === undefined;
            }
            return true;
        },
        {
            path: ["auth"],
            error: "When protocol is 'tcp' or 'udp', 'auth' must not be provided"
        }
    );

export function isTargetsOnlyResource(resource: any): boolean {
    return Object.keys(resource).length === 1 && resource.targets;
}

export const ClientResourceSchema = z
    .object({
        name: z.string().min(1).max(255),
        mode: z.enum(["host", "cidr"]),
        site: z.string(),
        // protocol: z.enum(["tcp", "udp"]).optional(),
        // proxyPort: z.int().positive().optional(),
        // destinationPort: z.int().positive().optional(),
        destination: z.string().min(1),
        // enabled: z.boolean().default(true),
        "tcp-ports": portRangeStringSchema.optional().default("*"),
        "udp-ports": portRangeStringSchema.optional().default("*"),
        "disable-icmp": z.boolean().optional().default(false),
        alias: z
            .string()
            .regex(
                /^(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?$/,
                "Alias must be a fully qualified domain name (e.g., example.com)"
            )
            .optional(),
        roles: z
            .array(z.string())
            .optional()
            .default([])
            .refine((roles) => !roles.includes("Admin"), {
                error: "Admin role cannot be included in roles"
            }),
        users: z.array(z.email()).optional().default([]),
        machines: z.array(z.string()).optional().default([])
    })
    .refine(
        (data) => {
            if (data.mode === "host") {
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
    );

// Schema for the entire configuration object
export const ConfigSchema = z
    .object({
        "proxy-resources": z
            .record(z.string(), ResourceSchema)
            .optional()
            .prefault({}),
        "public-resources": z
            .record(z.string(), ResourceSchema)
            .optional()
            .prefault({}),
        "client-resources": z
            .record(z.string(), ClientResourceSchema)
            .optional()
            .prefault({}),
        "private-resources": z
            .record(z.string(), ClientResourceSchema)
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
            "proxy-resources": Record<string, z.infer<typeof ResourceSchema>>;
            "client-resources": Record<
                string,
                z.infer<typeof ClientResourceSchema>
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
export type Resource = z.infer<typeof ResourceSchema>;
export type Config = z.infer<typeof ConfigSchema>;
