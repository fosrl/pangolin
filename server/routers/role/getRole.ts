import { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { db } from "@server/db";
import { roleActions, roles } from "@server/db";
import { and, eq } from "drizzle-orm";
import { ActionsEnum } from "@server/auth/actions";
import response from "@server/lib/response";
import HttpCode from "@server/types/HttpCode";
import createHttpError from "http-errors";
import logger from "@server/logger";
import { fromError } from "zod-validation-error";
import { OpenAPITags, registry } from "@server/openApi";

const getRoleSchema = z.strictObject({
    roleId: z.coerce.number().int().positive()
});

registry.registerPath({
    method: "get",
    path: "/role/{roleId}",
    description: "Get a role.",
    tags: [OpenAPITags.Role],
    request: {
        params: getRoleSchema
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

export async function getRole(
    req: Request,
    res: Response,
    next: NextFunction
): Promise<any> {
    try {
        const parsedParams = getRoleSchema.safeParse(req.params);
        if (!parsedParams.success) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    fromError(parsedParams.error).toString()
                )
            );
        }

        const { roleId } = parsedParams.data;

        const role = await db
            .select()
            .from(roles)
            .where(eq(roles.roleId, roleId))
            .limit(1);

        if (role.length === 0) {
            return next(
                createHttpError(
                    HttpCode.NOT_FOUND,
                    `Role with ID ${roleId} not found`
                )
            );
        }

        const [signSshKeyAction] = await db
            .select({ roleId: roleActions.roleId })
            .from(roleActions)
            .where(
                and(
                    eq(roleActions.roleId, roleId),
                    eq(roleActions.actionId, ActionsEnum.signSshKey)
                )
            )
            .limit(1);

        return response(res, {
            data: { ...role[0], allowSsh: !!signSshKeyAction },
            success: true,
            error: false,
            message: "Role retrieved successfully",
            status: HttpCode.OK
        });
    } catch (error) {
        logger.error(error);
        return next(
            createHttpError(HttpCode.INTERNAL_SERVER_ERROR, "An error occurred")
        );
    }
}
