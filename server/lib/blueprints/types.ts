import { z } from "zod";

export const SiteSchema = z.object({
    name: z.string().min(1).max(100),
    "docker-socket-enabled": z.boolean().optional().default(true)
});

export const TargetHealthCheckSchema = z.object({
    hostname: z.string(),
    port: z.number().int().min(1).max(65535),
    enabled: z.boolean().optional().default(true),
    path: z.string().optional(),
    scheme: z.string().optional(),
    mode: z.string().default("http"),
    interval: z.number().int().default(30),
    "unhealthy-interval": z.number().int().default(30),
    unhealthyInterval: z.number().int().optional(), // deprecated alias
    timeout: z.number().int().default(5),
    headers: z.array(z.object({ name: z.string(), value: z.string() })).nullable().optional().default(null),
    "follow-redirects": z.boolean().default(true),
    followRedirects: z.boolean().optional(), // deprecated alias
    method: z.string().default("GET"),
    status: z.number().int().optional()
});

// Schema for individual target within a resource
export const TargetSchema = z.object({
    site: z.string().optional(),
    method: z.enum(["http", "https", "h2c"]).optional(),
    hostname: z.string(),
    port: z.number().int().min(1).max(65535),
    enabled: z.boolean().optional().default(true),
    "internal-port": z.number().int().min(1).max(65535).optional(),
    path: z.string().optional(),
    "path-match": z.enum(["exact", "prefix", "regex"]).optional().nullable(),
    healthcheck: TargetHealthCheckSchema.optional(),
    rewritePath: z.string().optional(), // deprecated alias
    "rewrite-path": z.string().optional(),
    "rewrite-match": z.enum(["exact", "prefix", "regex", "stripPrefix"]).optional().nullable(),
    priority: z.number().int().min(1).max(1000).optional().default(100)
});
export type TargetData = z.infer<typeof TargetSchema>;

export const AuthSchema = z.object({
    // pincode has to have 6 digits
    pincode: z.number().min(100000).max(999999).optional(),
    password: z.string().min(1).optional(),
    "basic-auth": z.object({
        user: z.string().min(1),
        password: z.string().min(1)
    }).optional(),
    "sso-enabled": z.boolean().optional().default(false),
    "sso-roles": z
        .array(z.string())
        .optional()
        .default([])
        .refine((roles) => !roles.includes("Admin"), {
            message: "Admin role cannot be included in sso-roles"
        }),
    "sso-users": z.array(z.string().email()).optional().default([]),
    "whitelist-users": z.array(z.string().email()).optional().default([]),
    "auto-login-idp": z.number().int().positive().optional(),
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
        "proxy-port": z.number().int().min(1).max(65535).optional(),
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
            message:
                "Resource must either be targets-only (only 'targets' field) or have both 'name' and 'protocol' fields at a minimum",
            path: ["name", "protocol"]
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
            // If protocol is tcp or udp, no target should have method field
            if (resource.protocol === "tcp" || resource.protocol === "udp") {
                return resource.targets.every(
                    (target) => target == null || target.method === undefined
                );
            }
            return true;
        },
        (resource) => {
            if (resource.protocol === "http") {
                return {
                    message:
                        "When protocol is 'http', all targets must have a 'method' field",
                    path: ["targets"]
                };
            }
            return {
                message:
                    "When protocol is 'tcp' or 'udp', targets must not have a 'method' field",
                path: ["targets"]
            };
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
            message:
                "When protocol is 'http', a 'full-domain' must be provided",
            path: ["full-domain"]
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
            message:
                "When protocol is 'tcp' or 'udp', 'proxy-port' must be provided",
            path: ["proxy-port", "exit-node"]
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
            message:
                "When protocol is 'tcp' or 'udp', 'auth' must not be provided",
            path: ["auth"]
        }
    );

export function isTargetsOnlyResource(resource: any): boolean {
    return Object.keys(resource).length === 1 && resource.targets;
}

export const ClientResourceSchema = z.object({
    name: z.string().min(2).max(100),
    site: z.string().min(2).max(100).optional(),
    protocol: z.enum(["tcp", "udp"]),
    "proxy-port": z.number().min(1).max(65535),
    "hostname": z.string().min(1).max(255),
    "internal-port": z.number().min(1).max(65535),
    enabled: z.boolean().optional().default(true)
});

// Schema for the entire configuration object
export const ConfigSchema = z
    .object({
        "proxy-resources": z.record(z.string(), ResourceSchema).optional().default({}),
        "client-resources": z.record(z.string(), ClientResourceSchema).optional().default({}),
        sites: z.record(z.string(), SiteSchema).optional().default({})
    })
    .refine(
        // Enforce the full-domain uniqueness across resources in the same stack
        (config) => {
            // Extract all full-domain values with their resource keys
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

            // Find duplicates
            const duplicates = Array.from(fullDomainMap.entries()).filter(
                ([_, resourceKeys]) => resourceKeys.length > 1
            );

            return duplicates.length === 0;
        },
        (config) => {
            // Extract duplicates for error message
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

            const duplicates = Array.from(fullDomainMap.entries())
                .filter(([_, resourceKeys]) => resourceKeys.length > 1)
                .map(
                    ([fullDomain, resourceKeys]) =>
                        `'${fullDomain}' used by resources: ${resourceKeys.join(", ")}`
                )
                .join("; ");

            return {
                message: `Duplicate 'full-domain' values found: ${duplicates}`,
                path: ["resources"]
            };
        }
    )
    .refine(
        // Enforce proxy-port uniqueness within proxy-resources per protocol
        (config) => {
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

            // Find duplicates
            const duplicates = Array.from(protocolPortMap.entries()).filter(
                ([_, resourceKeys]) => resourceKeys.length > 1
            );

            return duplicates.length === 0;
        },
        (config) => {
            // Extract duplicates for error message
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

            const duplicates = Array.from(protocolPortMap.entries())
                .filter(([_, resourceKeys]) => resourceKeys.length > 1)
                .map(
                    ([protocolPort, resourceKeys]) => {
                        const [protocol, port] = protocolPort.split(':');
                        return `${protocol.toUpperCase()} port ${port} used by proxy-resources: ${resourceKeys.join(", ")}`;
                    }
                )
                .join("; ");

            return {
                message: `Duplicate 'proxy-port' values found in proxy-resources: ${duplicates}`,
                path: ["proxy-resources"]
            };
        }
    )
    .refine(
        // Enforce proxy-port uniqueness within client-resources
        (config) => {
            const proxyPortMap = new Map<number, string[]>();

            Object.entries(config["client-resources"]).forEach(
                ([resourceKey, resource]) => {
                    const proxyPort = resource["proxy-port"];
                    if (proxyPort !== undefined) {
                        if (!proxyPortMap.has(proxyPort)) {
                            proxyPortMap.set(proxyPort, []);
                        }
                        proxyPortMap.get(proxyPort)!.push(resourceKey);
                    }
                }
            );

            // Find duplicates
            const duplicates = Array.from(proxyPortMap.entries()).filter(
                ([_, resourceKeys]) => resourceKeys.length > 1
            );

            return duplicates.length === 0;
        },
        (config) => {
            // Extract duplicates for error message
            const proxyPortMap = new Map<number, string[]>();

            Object.entries(config["client-resources"]).forEach(
                ([resourceKey, resource]) => {
                    const proxyPort = resource["proxy-port"];
                    if (proxyPort !== undefined) {
                        if (!proxyPortMap.has(proxyPort)) {
                            proxyPortMap.set(proxyPort, []);
                        }
                        proxyPortMap.get(proxyPort)!.push(resourceKey);
                    }
                }
            );

            const duplicates = Array.from(proxyPortMap.entries())
                .filter(([_, resourceKeys]) => resourceKeys.length > 1)
                .map(
                    ([proxyPort, resourceKeys]) =>
                        `port ${proxyPort} used by client-resources: ${resourceKeys.join(", ")}`
                )
                .join("; ");

            return {
                message: `Duplicate 'proxy-port' values found in client-resources: ${duplicates}`,
                path: ["client-resources"]
            };
        }
    );

// Type inference from the schema
export type Site = z.infer<typeof SiteSchema>;
export type Target = z.infer<typeof TargetSchema>;
export type Resource = z.infer<typeof ResourceSchema>;
export type Config = z.infer<typeof ConfigSchema>;
