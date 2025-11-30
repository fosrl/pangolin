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

const removeEmailFromResourceWhitelistBodySchema = z
    .object({
        email: z
            .string()
            .email()
            .or(
                z.string().regex(/^\*@[\w.-]+\.[a-zA-Z]{2,}$/, {
                    message:
                        "Invalid email address. Wildcard (*) must be the entire local part."
                })
            )
            .transform((v) => v.toLowerCase())
    })
    .strict();

const removeEmailFromResourceWhitelistParamsSchema = z
    .object({
        resourceId: z
            .string()
            .transform(Number)
            .pipe(z.number().int().positive())
    })
    .strict();

registry.registerPath({
    method: "post",
    path: "/resource/{resourceId}/whitelist/remove",
    description: "Remove a single email from the resource whitelist.",
    tags: [OpenAPITags.Resource],
    request: {
        params: removeEmailFromResourceWhitelistParamsSchema,
        body: {
            content: {
                "application/json": {
                    schema: removeEmailFromResourceWhitelistBodySchema
                }
            }
        }
    },
    responses: {}
});

export async function removeEmailFromResourceWhitelist(
    req: Request,
    res: Response,
    next: NextFunction
): Promise<any> {
    try {
        const parsedBody = removeEmailFromResourceWhitelistBodySchema.safeParse(
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

        const parsedParams =
            removeEmailFromResourceWhitelistParamsSchema.safeParse(req.params);
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

        // Check if email exists in whitelist
        const existingEntry = await db
            .select()
            .from(resourceWhitelist)
            .where(
                and(
                    eq(resourceWhitelist.resourceId, resourceId),
                    eq(resourceWhitelist.email, email)
                )
            );

        if (existingEntry.length === 0) {
            return next(
                createHttpError(
                    HttpCode.NOT_FOUND,
                    "Email not found in whitelist"
                )
            );
        }

        await db
            .delete(resourceWhitelist)
            .where(
                and(
                    eq(resourceWhitelist.resourceId, resourceId),
                    eq(resourceWhitelist.email, email)
                )
            );

        return response(res, {
            data: {},
            success: true,
            error: false,
            message: "Email removed from whitelist successfully",
            status: HttpCode.OK
        });
    } catch (error) {
        logger.error(error);
        return next(
            createHttpError(HttpCode.INTERNAL_SERVER_ERROR, "An error occurred")
        );
    }
}
