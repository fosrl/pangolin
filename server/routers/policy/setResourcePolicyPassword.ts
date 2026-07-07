import { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { db } from "@server/db";
import { resourcePolicyPassword } from "@server/db";
import { eq } from "drizzle-orm";
import HttpCode from "@server/types/HttpCode";
import createHttpError from "http-errors";
import { fromError } from "zod-validation-error";
import { response } from "@server/lib/response";
import logger from "@server/logger";
import { hashPassword } from "@server/auth/password";
import { OpenAPITags, registry } from "@server/openApi";

const setResourcePolicyPasswordParamsSchema = z.object({
    resourcePolicyId: z.string().transform(Number).pipe(z.int().positive())
});

const setResourcePolicyPasswordBodySchema = z.strictObject({
    password: z.string().min(4).max(100).nullable()
});

registry.registerPath({
    method: "put",
    path: "/resource-policy/{resourcePolicyId}/password",
    description:
        "Set the password for a resource policy. Setting the password to null will remove it.",
    tags: [OpenAPITags.Policy],
    request: {
        params: setResourcePolicyPasswordParamsSchema,
        body: {
            content: {
                "application/json": {
                    schema: setResourcePolicyPasswordBodySchema
                }
            }
        }
    },
    responses: {}
});

export async function setResourcePolicyPassword(
    req: Request,
    res: Response,
    next: NextFunction
): Promise<any> {
    try {
        const parsedParams = setResourcePolicyPasswordParamsSchema.safeParse(
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

        const parsedBody = setResourcePolicyPasswordBodySchema.safeParse(
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

        const { resourcePolicyId } = parsedParams.data;
        const { password } = parsedBody.data;

        await db.transaction(async (trx) => {
            await trx
                .delete(resourcePolicyPassword)
                .where(
                    eq(
                        resourcePolicyPassword.resourcePolicyId,
                        resourcePolicyId
                    )
                );

            if (password) {
                const passwordHash = await hashPassword(password);

                await trx
                    .insert(resourcePolicyPassword)
                    .values({ resourcePolicyId, passwordHash });
            }
        });

        return response(res, {
            data: {},
            success: true,
            error: false,
            message: "Resource policy password set successfully",
            status: HttpCode.OK
        });
    } catch (error) {
        logger.error(error);
        return next(
            createHttpError(HttpCode.INTERNAL_SERVER_ERROR, "An error occurred")
        );
    }
}
