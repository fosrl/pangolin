import { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { db, userOrgs } from "@server/db";
import { and, eq } from "drizzle-orm";
import response from "@server/lib/response";
import HttpCode from "@server/types/HttpCode";
import createHttpError from "http-errors";
import logger from "@server/logger";
import { fromError } from "zod-validation-error";
import { OpenAPITags, registry } from "@server/openApi";

const paramsSchema = z.strictObject({
    userId: z.string(),
    orgId: z.string()
});

const bodySchema = z
    .strictObject({
        autoProvisioned: z.boolean().optional()
    })
    .refine((data) => Object.keys(data).length > 0, {
        error: "At least one field must be provided for update"
    });

registry.registerPath({
    method: "post",
    path: "/org/{orgId}/user/{userId}",
    description: "Update a user in an org.",
    tags: [OpenAPITags.Org],
    request: {
        params: paramsSchema,
        body: {
            content: {
                "application/json": {
                    schema: bodySchema
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

export async function updateOrgUser(
    req: Request,
    res: Response,
    next: NextFunction
): Promise<any> {
    try {
        const parsedParams = paramsSchema.safeParse(req.params);
        if (!parsedParams.success) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    fromError(parsedParams.error).toString()
                )
            );
        }

        const parsedBody = bodySchema.safeParse(req.body);
        if (!parsedBody.success) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    fromError(parsedBody.error).toString()
                )
            );
        }

        const { userId, orgId } = parsedParams.data;

        const [existingUser] = await db
            .select()
            .from(userOrgs)
            .where(and(eq(userOrgs.userId, userId), eq(userOrgs.orgId, orgId)))
            .limit(1);

        if (!existingUser) {
            return next(
                createHttpError(
                    HttpCode.NOT_FOUND,
                    "User not found in this organization"
                )
            );
        }

        const updateData = parsedBody.data;

        const [updatedUser] = await db
            .update(userOrgs)
            .set({
                ...updateData
            })
            .where(and(eq(userOrgs.userId, userId), eq(userOrgs.orgId, orgId)))
            .returning();

        return response(res, {
            data: updatedUser,
            success: true,
            error: false,
            message: "Org user updated successfully",
            status: HttpCode.OK
        });
    } catch (error) {
        logger.error(error);
        return next(
            createHttpError(HttpCode.INTERNAL_SERVER_ERROR, "An error occurred")
        );
    }
}
