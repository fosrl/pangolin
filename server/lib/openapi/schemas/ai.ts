import "@server/extendZod";
import { z } from "zod";

export const AiProviderTypeSchema = z
    .enum([
        "anthropic",
        "bedrock",
        "custom",
        "googleGemini",
        "microsoftFoundry",
        "openRouter",
        "openai",
        "vercelAiGateway",
        "vertexAi"
    ])
    .openapi({ description: "The AI provider this configuration talks to." });

export const AiProviderAttachmentSchema = z.object({
    providerId: z.number().int().openapi({
        description: "Numeric ID of the AI provider."
    }),
    niceId: z.string().openapi({
        description:
            "Human readable ID of the provider, unique within the organization."
    }),
    name: z.string().openapi({ description: "Provider name." }),
    type: AiProviderTypeSchema,
    enabled: z.boolean().openapi({
        description: "Whether the provider is enabled for this resource."
    }),
    providerEnabled: z.boolean().openapi({
        description: "Whether the provider itself is enabled."
    }),
    accessMode: z.enum(["inherit", "select"]).openapi({
        description:
            "inherit uses the provider's own allow/block model lists. select uses the models chosen on this resource."
    })
});

export const AiModelSelectionSchema = z.object({
    modelId: z
        .number()
        .int()
        .openapi({ description: "Numeric ID of the model." }),
    modelKey: z.string().openapi({
        description:
            "Identifier sent to the upstream provider to select the model."
    }),
    name: z.string().openapi({ description: "Display name of the model." }),
    providerId: z.number().int().openapi({
        description: "ID of the provider the model belongs to."
    }),
    enabled: z
        .boolean()
        .openapi({ description: "Whether the model is enabled." }),
    listType: z.enum(["allow", "block"]).openapi({
        description: "Whether the model is on the allow list or the block list."
    })
});
