import { z } from "zod";

export function createApiResponseSchema<T extends z.ZodTypeAny>(dataSchema: T) {
    return z.object({
        data: dataSchema.nullable(),
        success: z.boolean(),
        error: z.boolean(),
        message: z.string(),
        status: z.number()
    });
}
