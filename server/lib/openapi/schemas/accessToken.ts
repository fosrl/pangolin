import "@server/extendZod";
import { z } from "zod";

const tokenFields = {
    accessTokenId: z
        .string()
        .openapi({ description: "ID of the access token." }),
    orgId: z.string().openapi({ description: "ID of the organization." }),
    resourceId: z.number().int().openapi({
        description: "ID of the resource the token grants access to."
    }),
    userId: z.string().nullable().openapi({
        description: "ID of the user that created the token."
    }),
    sessionLength: z.number().int().openapi({
        description:
            "How long a session started with the token lasts, in milliseconds."
    }),
    expiresAt: z.number().int().nullable().openapi({
        description:
            "Epoch milliseconds when the token expires. Null means it never expires."
    }),
    title: z
        .string()
        .nullable()
        .openapi({ description: "Title of the token." }),
    description: z.string().nullable().openapi({
        description: "Description of the token."
    }),
    persistSession: z.boolean().openapi({
        description:
            "Whether sessions started with the token survive browser restarts."
    }),
    createdAt: z.number().int().openapi({
        description: "Epoch milliseconds when the token was created."
    })
};

export const GeneratedAccessTokenSchema = z.object({
    ...tokenFields,
    path: z.string().nullable().openapi({
        description: "Path users are sent to after they use the token."
    }),
    accessToken: z.string().openapi({
        description:
            "The token value. It is only returned once, when the token is generated."
    })
});

export const AccessTokenListItemSchema = z.object({
    ...tokenFields,
    userName: z
        .string()
        .nullable()
        .openapi({ description: "Name of the user that created the token." }),
    username: z.string().nullable().openapi({
        description: "Username of the user that created the token."
    }),
    userEmail: z
        .string()
        .nullable()
        .openapi({ description: "Email of the user that created the token." }),
    tokenHash: z.string().openapi({ description: "Hash of the token value." }),
    resourceName: z
        .string()
        .nullable()
        .openapi({ description: "Name of the resource." }),
    resourceNiceId: z.string().nullable().openapi({
        description: "Human readable ID of the resource."
    }),
    siteName: z.string().nullable().openapi({
        description: "Name of a site that serves the resource."
    })
});
