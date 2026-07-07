import { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { db, resourcePolicies, resourcePolicyWhiteList } from "@server/db";
import response from "@server/lib/response";
import HttpCode from "@server/types/HttpCode";
import createHttpError from "http-errors";
import logger from "@server/logger";
import { fromError } from "zod-validation-error";
import { and, eq } from "drizzle-orm";
import { OpenAPITags, registry } from "@server/openApi";

const setResourcePolicyWhitelistBodySchema = z.strictObject({
    emailWhitelistEnabled: z.boolean(),
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

const setResourcePolicyWhitelistParamsSchema = z.strictObject({
    resourcePolicyId: z.string().transform(Number).pipe(z.int().positive())
});

registry.registerPath({
    method: "put",
    path: "/resource-policy/{resourcePolicyId}/whitelist",
    description:
        "Set email whitelist for a resource policy. This will replace all existing emails.",
    tags: [OpenAPITags.Policy],
    request: {
        params: setResourcePolicyWhitelistParamsSchema,
        body: {
            content: {
                "application/json": {
                    schema: setResourcePolicyWhitelistBodySchema
                }
            }
        }
    },
    responses: {}
});

export async function setResourcePolicyWhitelist(
    req: Request,
    res: Response,
    next: NextFunction
): Promise<any> {
    try {
        const parsedBody = setResourcePolicyWhitelistBodySchema.safeParse(
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

        const parsedParams = setResourcePolicyWhitelistParamsSchema.safeParse(
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

        const { resourcePolicyId } = parsedParams.data;
        const { emailWhitelistEnabled, emails } = parsedBody.data;

        const [policy] = await db
            .select()
            .from(resourcePolicies)
            .where(eq(resourcePolicies.resourcePolicyId, resourcePolicyId));

        if (!policy) {
            return next(
                createHttpError(HttpCode.NOT_FOUND, "Resource policy not found")
            );
        }

        await db.transaction(async (trx) => {
            await trx
                .update(resourcePolicies)
                .set({ emailWhitelistEnabled })
                .where(eq(resourcePolicies.resourcePolicyId, resourcePolicyId));

            // delete all whitelist emails
            await trx
                .delete(resourcePolicyWhiteList)
                .where(
                    eq(
                        resourcePolicyWhiteList.resourcePolicyId,
                        resourcePolicyId
                    )
                );

            if (emailWhitelistEnabled && emails.length > 0) {
                await trx.insert(resourcePolicyWhiteList).values(
                    emails.map((email) => ({
                        email,
                        resourcePolicyId
                    }))
                );
            }
        });

        return response(res, {
            data: {},
            success: true,
            error: false,
            message: "Whitelist set for resource policy successfully",
            status: HttpCode.OK
        });
    } catch (error) {
        logger.error(error);
        return next(
            createHttpError(HttpCode.INTERNAL_SERVER_ERROR, "An error occurred")
        );
    }
}
