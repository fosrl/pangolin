import "@server/extendZod";
import { z } from "zod";
import { createSelectSchema } from "drizzle-zod";
import { blueprints } from "@server/db";

export const BlueprintSourceSchema = z.enum(["API", "UI", "NEWT", "CLI"]);
export type BlueprintSource = z.infer<typeof BlueprintSourceSchema>;

export const BlueprintSchema = createSelectSchema(blueprints, {
    blueprintId: (s) =>
        s.openapi({ description: "Numeric ID of the blueprint run." }),
    contents: (s) =>
        s.openapi({
            description: "The blueprint that was applied, as YAML or JSON."
        }),
    createdAt: (s) =>
        s.openapi({
            description: "Epoch seconds when the blueprint was applied."
        }),
    message: (s) =>
        s.openapi({
            description:
                "Result message, including the error when applying failed."
        }),
    name: (s) => s.openapi({ description: "Blueprint name." }),
    orgId: (s) => s.openapi({ description: "ID of the organization." }),
    source: z
        .enum(["API", "UI", "NEWT", "CLI"])
        .openapi({ description: "Where the blueprint was applied from." }),
    succeeded: (s) =>
        s.openapi({ description: "Whether applying the blueprint succeeded." })
});

export type BlueprintData = z.infer<typeof BlueprintSchema>;

export const BlueprintListItemSchema = BlueprintSchema.pick({
    blueprintId: true,
    orgId: true,
    name: true,
    source: true,
    succeeded: true,
    createdAt: true
});
