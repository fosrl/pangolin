import "@server/extendZod";
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

/**
 * Builds the `responses` entry for a successful call, wrapping `dataSchema`
 * in the standard API envelope. Use `status` for routes that don't return 200
 * (e.g. 201 for creates).
 */
export function createApiSuccessResponses<T extends z.ZodTypeAny>(
    dataSchema: T,
    status: 200 | 201 = 200,
    description = "Successful response"
) {
    return {
        [status]: {
            description,
            content: {
                "application/json": {
                    schema: createApiResponseSchema(dataSchema)
                }
            }
        }
    };
}

/**
 * For routes that respond with a CSV file instead of the JSON envelope.
 */
export function createCsvResponses(description: string) {
    return {
        200: {
            description,
            content: {
                "text/csv": {
                    schema: z.string().openapi({
                        description:
                            "CSV file. The first row holds the column names."
                    })
                }
            }
        }
    };
}

/** For routes that succeed with an empty `data` object (`data: {}`). */
export const EmptyDataSchema = z.object({});

/** For routes that succeed with `data: null`. */
export const NullDataSchema = z.null();

/**
 * Compile-time guard that a documented zod schema still matches the TS type
 * the handler returns. `type _Check = Assert<Equals<z.infer<typeof S>, Row>>`
 * fails to compile if the two drift apart.
 */
export type Equals<A, B> = [A] extends [B]
    ? [B] extends [A]
        ? true
        : false
    : false;
export type Assert<T extends true> = T;
