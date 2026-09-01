import { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { db } from "@server/db";
import { resourcePolicyPincode } from "@server/db";
import { eq } from "drizzle-orm";
import HttpCode from "@server/types/HttpCode";
import createHttpError from "http-errors";
import { fromError } from "zod-validation-error";
import { response } from "@server/lib/response";
import logger from "@server/logger";
import { hashPassword } from "@server/auth/password";
import { OpenAPITags, registry } from "@server/openApi";

const setResourcePolicyPincodeParamsSchema = z.object({
    resourcePolicyId: z.string().transform(Number).pipe(z.int().positive())
});

const setResourcePolicyPincodeBodySchema = z.strictObject({
    pincode: z
        .string()
        .regex(/^\d{6}$/)
        .or(z.null())
});

registry.registerPath({
    method: "post",
    path: "/resource-policy/{resourcePolicyId}/pincode",
    description:
        "Set the PIN code for a resource policy. Setting the PIN code to null will remove it.",
    tags: [OpenAPITags.PublicResourcePolicyLegacy],
    request: {
        params: setResourcePolicyPincodeParamsSchema,
        body: {
            content: {
                "application/json": {
                    schema: setResourcePolicyPincodeBodySchema
                }
            }
        }
    },
    responses: {}
});

registry.registerPath({
    method: "post",
    path: "/public-resource-policy/{resourcePolicyId}/pincode",
    description:
        "Set the PIN code for a resource policy. Setting the PIN code to null will remove it.",
    tags: [OpenAPITags.PublicResourcePolicy],
    request: {
        params: setResourcePolicyPincodeParamsSchema,
        body: {
            content: {
                "application/json": {
                    schema: setResourcePolicyPincodeBodySchema
                }
            }
        }
    },
    responses: {}
});

registry.registerPath({
    method: "put",
    path: "/resource-policy/{resourcePolicyId}/pincode",
    description:
        "Set the PIN code for a resource policy. Setting the PIN code to null will remove it. Deprecated: use POST instead.",
    deprecated: true,
    tags: [OpenAPITags.PublicResourcePolicyLegacy],
    request: {
        params: setResourcePolicyPincodeParamsSchema,
        body: {
            content: {
                "application/json": {
                    schema: setResourcePolicyPincodeBodySchema
                }
            }
        }
    },
    responses: {}
});

registry.registerPath({
    method: "put",
    path: "/public-resource-policy/{resourcePolicyId}/pincode",
    description:
        "Set the PIN code for a resource policy. Setting the PIN code to null will remove it. Deprecated: use POST instead.",
    deprecated: true,
    tags: [OpenAPITags.PublicResourcePolicy],
    request: {
        params: setResourcePolicyPincodeParamsSchema,
        body: {
            content: {
                "application/json": {
                    schema: setResourcePolicyPincodeBodySchema
                }
            }
        }
    },
    responses: {}
});

export async function setResourcePolicyPincode(
    req: Request,
    res: Response,
    next: NextFunction
): Promise<any> {
    try {
        const parsedParams = setResourcePolicyPincodeParamsSchema.safeParse(
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

        const parsedBody = setResourcePolicyPincodeBodySchema.safeParse(
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
        const { pincode } = parsedBody.data;

        await db.transaction(async (trx) => {
            await trx
                .delete(resourcePolicyPincode)
                .where(
                    eq(resourcePolicyPincode.resourcePolicyId, resourcePolicyId)
                );

            if (pincode) {
                const pincodeHash = await hashPassword(pincode);

                await trx
                    .insert(resourcePolicyPincode)
                    .values({ resourcePolicyId, pincodeHash, digitLength: 6 });
            }
        });

        return response(res, {
            data: {},
            success: true,
            error: false,
            message: "Resource policy PIN code set successfully",
            status: HttpCode.OK
        });
    } catch (error) {
        logger.error(error);
        return next(
            createHttpError(HttpCode.INTERNAL_SERVER_ERROR, "An error occurred")
        );
    }
}
