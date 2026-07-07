import { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { db } from "@server/db";
import { resources, resourceWhitelist } from "@server/db";
import response from "@server/lib/response";
import HttpCode from "@server/types/HttpCode";
import createHttpError from "http-errors";
import logger from "@server/logger";
import { fromError } from "zod-validation-error";
import { and, eq } from "drizzle-orm";
import { OpenAPITags, registry } from "@server/openApi";

const addEmailToResourceWhitelistBodySchema = z.strictObject({
    email: z
        .email()
        .or(
            z.string().regex(/^\*@[\w.-]+\.[a-zA-Z]{2,}$/, {
                error: "Invalid email address. Wildcard (*) must be the entire local part."
            })
        )
        .transform((v) => v.toLowerCase())
});

const addEmailToResourceWhitelistParamsSchema = z.strictObject({
    resourceId: z.coerce.number().int().positive()
});

registry.registerPath({
    method: "post",
    path: "/resource/{resourceId}/whitelist/add",
    description: "Add a single email to the resource whitelist.",
    tags: [OpenAPITags.PublicResource],
    request: {
        params: addEmailToResourceWhitelistParamsSchema,
        body: {
            content: {
                "application/json": {
                    schema: addEmailToResourceWhitelistBodySchema
                }
            }
        }
    },
    responses: {
        200: {
            description: "Successful response",
            content: {
                "application/json": {
                    schema: z.object({
                        data: z.record(z.string(), z.any()).nullable(),
                        success: z.boolean(),
                        error: z.boolean(),
                        message: z.string(),
                        status: z.number()
                    })
                }
            }
        }
    }
});

export async function addEmailToResourceWhitelist(
    req: Request,
    res: Response,
    next: NextFunction
): Promise<any> {
    try {
        const parsedBody = addEmailToResourceWhitelistBodySchema.safeParse(
            req.body
        );
        if (!parsedBody.success) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    fromError(parsedBody.error).toString()
                )
            );
        }

        const { email } = parsedBody.data;

        const parsedParams = addEmailToResourceWhitelistParamsSchema.safeParse(
            req.params
        );
        if (!parsedParams.success) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    fromError(parsedParams.error).toString()
                )
            );
        }

        const { resourceId } = parsedParams.data;

        const [resource] = await db
            .select()
            .from(resources)
            .where(eq(resources.resourceId, resourceId));

        if (!resource) {
            return next(
                createHttpError(HttpCode.NOT_FOUND, "Resource not found")
            );
        }

        if (!resource.emailWhitelistEnabled) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    "Email whitelist is not enabled for this resource"
                )
            );
        }

        // Check if email already exists in whitelist
        const existingEntry = await db
            .select()
            .from(resourceWhitelist)
            .where(
                and(
                    eq(resourceWhitelist.resourceId, resourceId),
                    eq(resourceWhitelist.email, email)
                )
            );

        if (existingEntry.length > 0) {
            return next(
                createHttpError(
                    HttpCode.CONFLICT,
                    "Email already exists in whitelist"
                )
            );
        }

        await db.insert(resourceWhitelist).values({
            email,
            resourceId
        });

        return response(res, {
            data: {},
            success: true,
            error: false,
            message: "Email added to whitelist successfully",
            status: HttpCode.CREATED
        });
    } catch (error) {
        logger.error(error);
        return next(
            createHttpError(HttpCode.INTERNAL_SERVER_ERROR, "An error occurred")
        );
    }
}
