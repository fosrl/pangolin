import { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { db } from "@server/db";
import {
    resources,
    resourceWhitelist,
    resourcePolicies,
    resourcePolicyWhiteList
} from "@server/db";
import response from "@server/lib/response";
import HttpCode from "@server/types/HttpCode";
import createHttpError from "http-errors";
import logger from "@server/logger";
import { fromError } from "zod-validation-error";
import { and, eq } from "drizzle-orm";
import { OpenAPITags, registry } from "@server/openApi";

const setResourceWhitelistBodySchema = z.strictObject({
    emails: z
        .array(
            z.email().or(
                z.string().regex(/^\*@[\w.-]+\.[a-zA-Z]{2,}$/, {
                    error: "Invalid email address. Wildcard (*) must be the entire local part."
                })
            )
        )
        .max(50)
        .transform((v) => v.map((e) => e.toLowerCase()))
});

const setResourceWhitelistParamsSchema = z.strictObject({
    resourceId: z.coerce.number().int().positive()
});

registry.registerPath({
    method: "post",
    path: "/resource/{resourceId}/whitelist",
    description:
        "Set email whitelist for a resource. This will replace all existing emails.",
    tags: [OpenAPITags.PublicResource],
    request: {
        params: setResourceWhitelistParamsSchema,
        body: {
            content: {
                "application/json": {
                    schema: setResourceWhitelistBodySchema
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

export async function setResourceWhitelist(
    req: Request,
    res: Response,
    next: NextFunction
): Promise<any> {
    try {
        const parsedBody = setResourceWhitelistBodySchema.safeParse(req.body);
        if (!parsedBody.success) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    fromError(parsedBody.error).toString()
                )
            );
        }

        const { emails } = parsedBody.data;

        const parsedParams = setResourceWhitelistParamsSchema.safeParse(
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

        const isInlinePolicy =
            resource.resourcePolicyId === null &&
            resource.defaultResourcePolicyId !== null;

        if (isInlinePolicy) {
            const policyId = resource.defaultResourcePolicyId!;

            const [policy] = await db
                .select()
                .from(resourcePolicies)
                .where(eq(resourcePolicies.resourcePolicyId, policyId));

            if (!policy) {
                return next(
                    createHttpError(
                        HttpCode.NOT_FOUND,
                        "Resource policy not found"
                    )
                );
            }

            if (!policy.emailWhitelistEnabled) {
                return next(
                    createHttpError(
                        HttpCode.BAD_REQUEST,
                        "Email whitelist is not enabled for this resource"
                    )
                );
            }

            const existingPolicyWhitelist = await db
                .select()
                .from(resourcePolicyWhiteList)
                .where(eq(resourcePolicyWhiteList.resourcePolicyId, policyId));

            await db.transaction(async (trx) => {
                const existingEmails = existingPolicyWhitelist.map(
                    (w) => w.email
                );

                const emailsToAdd = emails.filter(
                    (e) => !existingEmails.includes(e)
                );
                const emailsToRemove = existingEmails.filter(
                    (e) => !emails.includes(e)
                );

                for (const email of emailsToAdd) {
                    await trx.insert(resourcePolicyWhiteList).values({
                        email,
                        resourcePolicyId: policyId
                    });
                }

                for (const email of emailsToRemove) {
                    await trx
                        .delete(resourcePolicyWhiteList)
                        .where(
                            and(
                                eq(
                                    resourcePolicyWhiteList.resourcePolicyId,
                                    policyId
                                ),
                                eq(resourcePolicyWhiteList.email, email)
                            )
                        );
                }

                return response(res, {
                    data: {},
                    success: true,
                    error: false,
                    message: "Whitelist set for resource successfully",
                    status: HttpCode.CREATED
                });
            });
        } else {
            if (!resource.emailWhitelistEnabled) {
                return next(
                    createHttpError(
                        HttpCode.BAD_REQUEST,
                        "Email whitelist is not enabled for this resource"
                    )
                );
            }

            const whitelist = await db
                .select()
                .from(resourceWhitelist)
                .where(eq(resourceWhitelist.resourceId, resourceId));

            await db.transaction(async (trx) => {
                // diff the emails
                const existingEmails = whitelist.map((w) => w.email);

                const emailsToAdd = emails.filter(
                    (e) => !existingEmails.includes(e)
                );
                const emailsToRemove = existingEmails.filter(
                    (e) => !emails.includes(e)
                );

                for (const email of emailsToAdd) {
                    await trx.insert(resourceWhitelist).values({
                        email,
                        resourceId
                    });
                }

                for (const email of emailsToRemove) {
                    await trx
                        .delete(resourceWhitelist)
                        .where(
                            and(
                                eq(resourceWhitelist.resourceId, resourceId),
                                eq(resourceWhitelist.email, email)
                            )
                        );
                }

                return response(res, {
                    data: {},
                    success: true,
                    error: false,
                    message: "Whitelist set for resource successfully",
                    status: HttpCode.CREATED
                });
            });
        }
    } catch (error) {
        logger.error(error);
        return next(
            createHttpError(HttpCode.INTERNAL_SERVER_ERROR, "An error occurred")
        );
    }
}
