import "@server/extendZod";
import { z } from "zod";

export const LabelSchema = z.object({
    labelId: z
        .number()
        .int()
        .openapi({ description: "Numeric ID of the label." }),
    orgId: z.string().openapi({ description: "ID of the organization." }),
    name: z.string().openapi({ description: "Label name." }),
    color: z
        .string()
        .openapi({ description: "Label color, for example a hex code." })
});

export const LabelListItemSchema = LabelSchema.omit({ orgId: true });

export const BlueprintListItemSchema = z.object({
    blueprintId: z
        .number()
        .int()
        .openapi({ description: "Numeric ID of the blueprint run." }),
    orgId: z.string().openapi({ description: "ID of the organization." }),
    name: z.string().openapi({ description: "Blueprint name." }),
    source: z.enum(["API", "UI", "NEWT", "CLI"]).openapi({
        description: "Where the blueprint was applied from."
    }),
    succeeded: z
        .boolean()
        .openapi({ description: "Whether applying the blueprint succeeded." }),
    createdAt: z.number().int().openapi({
        description: "Epoch seconds when the blueprint was applied."
    })
});

export const BlueprintSchema = BlueprintListItemSchema.extend({
    message: z.string().nullable().openapi({
        description: "Result message, including the error when applying failed."
    }),
    contents: z.string().openapi({
        description: "The blueprint that was applied, as YAML or JSON."
    })
});

const hc = {
    targetHealthCheckId: z
        .number()
        .int()
        .openapi({ description: "Numeric ID of the health check." }),
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
    hcEnabled: z
        .boolean()
        .openapi({ description: "Whether the health check is running." }),
    hcHealth: z.enum(["unknown", "healthy", "unhealthy"]).openapi({
        description: "Current health reported by the check."
    }),
    hcMode: z
        .string()
        .nullable()
        .openapi({ description: "Kind of check, for example http or tcp." }),
    hcHostname: z
        .string()
        .nullable()
        .openapi({ description: "Host the check connects to." }),
    hcPort: z
        .number()
        .int()
        .nullable()
        .openapi({ description: "Port the check connects to." }),
    hcPath: z
        .string()
        .nullable()
        .openapi({ description: "Request path for http checks." }),
    hcScheme: z
        .string()
        .nullable()
        .openapi({ description: "Scheme for http checks (http or https)." }),
    hcMethod: z
        .string()
        .nullable()
        .openapi({ description: "HTTP method for http checks." }),
    hcInterval: z.number().int().nullable().openapi({
        description: "Seconds between checks while healthy."
    }),
    hcUnhealthyInterval: z.number().int().nullable().openapi({
        description: "Seconds between checks while unhealthy."
    }),
    hcTimeout: z
        .number()
        .int()
        .nullable()
        .openapi({ description: "Seconds before a check times out." }),
    hcHeaders: z.string().nullable().openapi({
        description: "Custom request headers for http checks, as a JSON string."
    }),
    hcFollowRedirects: z.boolean().nullable().openapi({
        description: "Whether http checks follow redirects."
    }),
    hcStatus: z.number().int().nullable().openapi({
        description: "HTTP status code a check must return to be healthy."
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
};

export const HealthCheckListItemSchema = z.object(hc);
