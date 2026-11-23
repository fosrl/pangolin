import "@server/extendZod";
import { z } from "zod";
import { createSelectSchema } from "drizzle-zod";
import { LimitOffsetPaginationSchema } from "@server/lib/openapi/pagination";
import { targetHealthCheck } from "@server/db";

export const HealthCheckListItemSchema = createSelectSchema(targetHealthCheck, {
    targetHealthCheckId: (s) =>
        s.openapi({ description: "Numeric ID of the health check." }),
    hcEnabled: (s) =>
        s.openapi({ description: "Whether the health check is running." }),
    hcMode: (s) =>
        s.openapi({ description: "Kind of check, for example http or tcp." }),
    hcHostname: (s) =>
        s.openapi({ description: "Host the check connects to." }),
    hcPort: (s) => s.openapi({ description: "Port the check connects to." }),
    hcPath: (s) => s.openapi({ description: "Request path for http checks." }),
    hcScheme: (s) =>
        s.openapi({ description: "Scheme for http checks (http or https)." }),
    hcMethod: (s) => s.openapi({ description: "HTTP method for http checks." }),
    hcInterval: (s) =>
        s.openapi({ description: "Seconds between checks while healthy." }),
    hcUnhealthyInterval: (s) =>
        s.openapi({ description: "Seconds between checks while unhealthy." }),
    hcTimeout: (s) =>
        s.openapi({ description: "Seconds before a check times out." }),
    hcHeaders: (s) =>
        s.openapi({
            description:
                "Custom request headers for http checks, as a JSON string."
        }),
    hcFollowRedirects: (s) =>
        s.openapi({ description: "Whether http checks follow redirects." }),
    hcStatus: (s) =>
        s.openapi({
            description: "HTTP status code a check must return to be healthy."
        }),
    hcTlsServerName: (s) =>
        s.openapi({
            description: "TLS server name (SNI) used for https checks."
        }),
    hcHealthyThreshold: (s) =>
        s.openapi({
            description:
                "Consecutive successful checks needed to mark the target healthy."
        }),
    hcUnhealthyThreshold: (s) =>
        s.openapi({
            description:
                "Consecutive failed checks needed to mark the target unhealthy."
        })
})
    .pick({
        targetHealthCheckId: true,
        hcEnabled: true,
        hcMode: true,
        hcHostname: true,
        hcPort: true,
        hcPath: true,
        hcScheme: true,
        hcMethod: true,
        hcInterval: true,
        hcUnhealthyInterval: true,
        hcTimeout: true,
        hcHeaders: true,
        hcFollowRedirects: true,
        hcStatus: true,
        hcTlsServerName: true,
        hcHealthyThreshold: true,
        hcUnhealthyThreshold: true
    })
    .extend({
        name: z.string().openapi({ description: "Health check name." }),
        siteId: z.number().int().nullable().openapi({
            description: "ID of the site that runs the check."
        }),
        siteName: z
            .string()
            .nullable()
            .openapi({ description: "Name of the site that runs the check." }),
        siteNiceId: z.string().nullable().openapi({
            description: "Human readable ID of the site that runs the check."
        }),
        hcHealth: z.enum(["unknown", "healthy", "unhealthy"]).openapi({
            description: "Current health reported by the check."
        }),
        resourceId: z.number().int().nullable().openapi({
            description: "ID of the resource the checked target belongs to."
        }),
        resourceName: z
            .string()
            .nullable()
            .openapi({ description: "Name of that resource." }),
        resourceNiceId: z.string().nullable().openapi({
            description: "Human readable ID of that resource."
        })
    });

export const ListHealthChecksResponseDataSchema = z.object({
    healthChecks: z.array(HealthCheckListItemSchema),
    pagination: LimitOffsetPaginationSchema
});
export type ListHealthChecksResponse = z.infer<
    typeof ListHealthChecksResponseDataSchema
>;
