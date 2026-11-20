import "@server/extendZod";
import { z } from "zod";

const hcHeadersSchema = z.array(
    z.object({
        name: z.string().openapi({ description: "Header name." }),
        value: z.string().openapi({ description: "Header value." })
    })
);

export const TargetSchema = z.object({
    targetId: z
        .number()
        .int()
        .openapi({ description: "Numeric ID of the target." }),
    resourceId: z.number().int().nullable().openapi({
        description: "ID of the public resource the target belongs to."
    }),
    providerId: z.number().int().nullable().openapi({
        description:
            "ID of the AI provider the target belongs to, for provider targets."
    }),
    siteId: z.number().int().openapi({
        description: "ID of the site that connects to the target."
    }),
    ip: z
        .string()
        .openapi({ description: "IP address or hostname of the target." }),
    method: z.string().nullable().openapi({
        description: "Protocol used to reach the target (http, https or h2c)."
    }),
    port: z.number().int().openapi({ description: "Port of the target." }),
    internalPort: z.number().int().nullable().openapi({
        description: "Port allocated on the site for raw TCP and UDP targets."
    }),
    mode: z.enum(["http", "rdp", "ssh", "tcp", "udp", "vnc"]).openapi({
        description: "Protocol mode of the target."
    }),
    enabled: z.boolean().openapi({
        description: "Whether the target receives traffic."
    }),
    path: z.string().nullable().openapi({
        description: "Path the target is matched on."
    }),
    pathMatchType: z.string().nullable().openapi({
        description: "How path is matched: exact, prefix or regex."
    }),
    rewritePath: z.string().nullable().openapi({
        description: "Path the request is rewritten to before it is forwarded."
    }),
    rewritePathType: z.string().nullable().openapi({
        description:
            "How rewritePath is applied: exact, prefix, regex or stripPrefix."
    }),
    priority: z.number().int().openapi({
        description:
            "Priority used when several targets match a request. Higher wins."
    }),
    authToken: z.string().nullable().openapi({
        description: "Token the site presents to the target, when required."
    })
});

const healthCheckFields = {
    targetHealthCheckId: z.number().int().openapi({
        description: "Numeric ID of the health check."
    }),
    orgId: z.string().openapi({
        description: "ID of the organization the health check belongs to."
    }),
    name: z.string().nullable().openapi({ description: "Health check name." }),
    hcEnabled: z.boolean().openapi({
        description: "Whether the health check is running."
    }),
    hcMode: z.string().nullable().openapi({
        description: "Kind of check performed, for example http or tcp."
    }),
    hcScheme: z.string().nullable().openapi({
        description: "Scheme used for http checks (http or https)."
    }),
    hcHostname: z.string().nullable().openapi({
        description: "Host the health check connects to."
    }),
    hcPort: z.number().int().nullable().openapi({
        description: "Port the health check connects to."
    }),
    hcPath: z.string().nullable().openapi({
        description: "Request path for http checks."
    }),
    hcMethod: z.string().nullable().openapi({
        description: "HTTP method for http checks."
    }),
    hcInterval: z.number().int().nullable().openapi({
        description: "Seconds between checks while the target is healthy."
    }),
    hcUnhealthyInterval: z.number().int().nullable().openapi({
        description: "Seconds between checks while the target is unhealthy."
    }),
    hcTimeout: z.number().int().nullable().openapi({
        description: "Seconds before a check times out."
    }),
    hcStatus: z.number().int().nullable().openapi({
        description: "HTTP status code a check must return to be healthy."
    }),
    hcFollowRedirects: z.boolean().nullable().openapi({
        description: "Whether http checks follow redirects."
    }),
    hcTlsServerName: z.string().nullable().openapi({
        description: "TLS server name (SNI) used for https checks."
    }),
    hcHealthyThreshold: z.number().int().nullable().openapi({
        description:
            "Consecutive successful checks needed to mark the target healthy."
    }),
    hcUnhealthyThreshold: z.number().int().nullable().openapi({
        description:
            "Consecutive failed checks needed to mark the target unhealthy."
    }),
    hcHealth: z.enum(["healthy", "unhealthy", "unknown"]).nullable().openapi({
        description: "Current health of the target."
    })
};

/** Target merged with its health check, with hcHeaders as stored (a JSON string). */
export const TargetWithHealthCheckSchema = TargetSchema.extend({
    ...healthCheckFields,
    hcHeaders: z.string().nullable().openapi({
        description: "Custom request headers for http checks, as a JSON string."
    })
});

export const TargetDetailSchema = TargetSchema.extend(
    z
        .object(healthCheckFields)
        .omit({ targetHealthCheckId: true, orgId: true })
        .partial().shape
).extend({
    targetHealthCheckId: healthCheckFields.targetHealthCheckId.optional(),
    orgId: healthCheckFields.orgId.optional(),
    hcHeaders: hcHeadersSchema.nullable().optional().openapi({
        description: "Custom request headers for http checks."
    })
});

export const TargetListItemSchema = z.object({
    targetId: TargetSchema.shape.targetId,
    ip: TargetSchema.shape.ip,
    mode: TargetSchema.shape.mode,
    method: TargetSchema.shape.method,
    port: TargetSchema.shape.port,
    enabled: TargetSchema.shape.enabled,
    resourceId: TargetSchema.shape.resourceId,
    providerId: TargetSchema.shape.providerId,
    siteId: TargetSchema.shape.siteId,
    siteType: z.string().nullable().openapi({
        description: "Kind of site that connects to the target."
    }),
    siteName: z.string().nullable().openapi({
        description: "Name of the site that connects to the target."
    }),
    path: TargetSchema.shape.path,
    pathMatchType: TargetSchema.shape.pathMatchType,
    rewritePath: TargetSchema.shape.rewritePath,
    rewritePathType: TargetSchema.shape.rewritePathType,
    priority: TargetSchema.shape.priority,
    hcEnabled: healthCheckFields.hcEnabled.nullable(),
    hcPath: healthCheckFields.hcPath,
    hcScheme: healthCheckFields.hcScheme,
    hcMode: healthCheckFields.hcMode,
    hcHostname: healthCheckFields.hcHostname,
    hcPort: healthCheckFields.hcPort,
    hcInterval: healthCheckFields.hcInterval,
    hcUnhealthyInterval: healthCheckFields.hcUnhealthyInterval,
    hcTimeout: healthCheckFields.hcTimeout,
    hcHeaders: hcHeadersSchema.nullable().openapi({
        description: "Custom request headers for http checks."
    }),
    hcFollowRedirects: healthCheckFields.hcFollowRedirects,
    hcMethod: healthCheckFields.hcMethod,
    hcStatus: healthCheckFields.hcStatus,
    hcHealth: healthCheckFields.hcHealth,
    hcTlsServerName: healthCheckFields.hcTlsServerName,
    hcHealthyThreshold: healthCheckFields.hcHealthyThreshold,
    hcUnhealthyThreshold: healthCheckFields.hcUnhealthyThreshold
});
