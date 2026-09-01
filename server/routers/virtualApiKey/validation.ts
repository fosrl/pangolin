import { z } from "zod";

export const virtualApiKeyResourceIdsSchema = z
    .array(z.coerce.number().int().positive())
    .optional();

const virtualApiKeyEmailFieldsSchema = {
    sendEmail: z.boolean().optional().default(false),
    sendToAttributedUser: z.boolean().optional().default(false),
    emails: z.array(z.email().toLowerCase()).max(20).optional().default([])
};

function refineVirtualApiKeyEmailFields(
    data: {
        sendEmail: boolean;
        sendToAttributedUser: boolean;
        emails: string[];
        userId?: string | null;
    },
    ctx: z.RefinementCtx
) {
    if (!data.sendEmail) {
        return;
    }

    if (!data.sendToAttributedUser && data.emails.length === 0) {
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message:
                "Select the associated user or add at least one email address",
            path: ["sendEmail"]
        });
    }

    if (data.sendToAttributedUser && !data.userId) {
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "Associate a user to email the key to that user",
            path: ["sendToAttributedUser"]
        });
    }
}

export const createVirtualApiKeyBodySchema = z
    .strictObject({
        name: z.string().nonempty(),
        description: z.string().optional().nullable(),
        userId: z.string().optional().nullable(),
        allResources: z.boolean().optional().default(false),
        resourceIds: virtualApiKeyResourceIdsSchema,
        validForSeconds: z.int().positive().optional(),
        ...virtualApiKeyEmailFieldsSchema
    })
    .refine(
        (data) => data.allResources || (data.resourceIds?.length ?? 0) > 0,
        {
            message:
                "Select at least one public inference resource, or enable all public inference resources",
            path: ["resourceIds"]
        }
    )
    .superRefine(refineVirtualApiKeyEmailFields);

export const updateVirtualApiKeyBodySchema = z
    .strictObject({
        name: z.string().nonempty().optional(),
        description: z.string().optional().nullable(),
        userId: z.string().optional().nullable(),
        allResources: z.boolean().optional(),
        resourceIds: virtualApiKeyResourceIdsSchema,
        validForSeconds: z.int().positive().optional().nullable(),
        ...virtualApiKeyEmailFieldsSchema
    })
    .superRefine((data, ctx) => {
        if (!data.sendEmail) {
            return;
        }

        if (!data.sendToAttributedUser && data.emails.length === 0) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message:
                    "Select the associated user or add at least one email address",
                path: ["sendEmail"]
            });
        }
    });
