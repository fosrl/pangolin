import "@server/extendZod";
import { z } from "zod";
import { createSelectSchema } from "drizzle-zod";
import { targetHealthCheck, targets } from "@server/db";

export const TargetSchema = createSelectSchema(targets, {
    authToken: (s) =>
        s.openapi({
            description: "Token the site presents to the target, when required."
        }),
    enabled: (s) =>
        s.openapi({ description: "Whether the target receives traffic." }),
    internalPort: (s) =>
        s.openapi({
            description:
                "Port allocated on the site for raw TCP and UDP targets."
        }),
    ip: (s) =>
        s.openapi({ description: "IP address or hostname of the target." }),
    method: (s) =>
        s.openapi({
            description:
                "Protocol used to reach the target (http, https or h2c)."
        }),
    mode: z
        .enum(["http", "rdp", "ssh", "tcp", "udp", "vnc"])
        .openapi({ description: "Protocol mode of the target." }),
    path: (s) => s.openapi({ description: "Path the target is matched on." }),
    pathMatchType: (s) =>
        s.openapi({
            description: "How path is matched: exact, prefix or regex."
        }),
    port: (s) => s.openapi({ description: "Port of the target." }),
    priority: (s) =>
        s.openapi({
            description:
                "Priority used when several targets match a request. Higher wins."
        }),
    providerId: (s) =>
        s.openapi({
            description:
                "ID of the AI provider the target belongs to, for provider targets."
        }),
    resourceId: (s) =>
        s.openapi({
            description: "ID of the public resource the target belongs to."
        }),
    rewritePath: (s) =>
        s.openapi({
            description:
                "Path the request is rewritten to before it is forwarded."
        }),
    rewritePathType: (s) =>
        s.openapi({
            description:
                "How rewritePath is applied: exact, prefix, regex or stripPrefix."
        }),
    siteId: (s) =>
        s.openapi({
            description: "ID of the site that connects to the target."
        }),
    targetId: (s) => s.openapi({ description: "Numeric ID of the target." })
});

export const TargetHealthCheckSchema = createSelectSchema(targetHealthCheck, {
    hcEnabled: (s) =>
        s.openapi({ description: "Whether the health check is running." }),
    hcFollowRedirects: (s) =>
        s.openapi({ description: "Whether http checks follow redirects." }),
    hcHeaders: (s) =>
        s.openapi({
            description:
                "Custom request headers for http checks, as a JSON string."
        }),
    hcHealth: z
        .enum(["healthy", "unhealthy", "unknown"])
        .nullable()
        .openapi({ description: "Current health of the target." }),
    hcHealthyThreshold: (s) =>
        s.openapi({
            description:
                "Consecutive successful checks needed to mark the target healthy."
        }),
    hcHostname: (s) =>
        s.openapi({ description: "Host the health check connects to." }),
    hcInterval: (s) =>
        s.openapi({
            description: "Seconds between checks while the target is healthy."
        }),
    hcMethod: (s) => s.openapi({ description: "HTTP method for http checks." }),
    hcMode: (s) =>
        s.openapi({
            description: "Kind of check performed, for example http or tcp."
        }),
    hcPath: (s) => s.openapi({ description: "Request path for http checks." }),
    hcPort: (s) =>
        s.openapi({ description: "Port the health check connects to." }),
    hcScheme: (s) =>
        s.openapi({
            description: "Scheme used for http checks (http or https)."
        }),
    hcStatus: (s) =>
        s.openapi({
            description: "HTTP status code a check must return to be healthy."
        }),
    hcTimeout: (s) =>
        s.openapi({ description: "Seconds before a check times out." }),
    hcTlsServerName: (s) =>
        s.openapi({
            description: "TLS server name (SNI) used for https checks."
        }),
    hcUnhealthyInterval: (s) =>
        s.openapi({
            description: "Seconds between checks while the target is unhealthy."
        }),
    hcUnhealthyThreshold: (s) =>
        s.openapi({
            description:
                "Consecutive failed checks needed to mark the target unhealthy."
        }),
    name: (s) => s.openapi({ description: "Health check name." }),
    orgId: (s) =>
        s.openapi({
            description: "ID of the organization the health check belongs to."
        }),
    targetHealthCheckId: (s) =>
        s.openapi({ description: "Numeric ID of the health check." })
});

/** A target merged with its health check. hcHeaders is the stored JSON string. */
export const TargetWithHealthCheckSchema = TargetSchema.extend(
    TargetHealthCheckSchema.omit({ targetId: true, siteId: true }).shape
);
