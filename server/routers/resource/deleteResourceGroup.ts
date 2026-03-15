import { db, resourceGroups } from "@server/db";
import response from "@server/lib/response";
import HttpCode from "@server/types/HttpCode";
import { and, eq } from "drizzle-orm";
import { NextFunction, Request, Response } from "express";
import createHttpError from "http-errors";
import { z } from "zod";
import { fromZodError } from "zod-validation-error";
import logger from "@server/logger";

const deleteResourceGroupParamsSchema = z.strictObject({
    orgId: z.string(),
    groupId: z.string().transform(Number).pipe(z.int().positive())
});

export type DeleteResourceGroupResponse = {};

export async function deleteResourceGroup(
    req: Request,
    res: Response,
    next: NextFunction
): Promise<any> {
    try {
        const parsedParams = deleteResourceGroupParamsSchema.safeParse(
            req.params
        );
        if (!parsedParams.success) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    fromZodError(parsedParams.error)
                )
            );
        }

        const { orgId, groupId } = parsedParams.data;

        const [existing] = await db
            .select()
            .from(resourceGroups)
            .where(
                and(
                    eq(resourceGroups.groupId, groupId),
                    eq(resourceGroups.orgId, orgId)
                )
            )
            .limit(1);

        if (!existing) {
            return next(
                createHttpError(
                    HttpCode.NOT_FOUND,
                    `Resource group with ID ${groupId} not found`
                )
            );
        }

        await db
            .delete(resourceGroups)
            .where(eq(resourceGroups.groupId, groupId));

        return response<DeleteResourceGroupResponse>(res, {
            data: {},
            success: true,
            error: false,
            message: "Resource group deleted successfully",
            status: HttpCode.OK
        });
    } catch (error) {
        logger.error(error);
        return next(
            createHttpError(HttpCode.INTERNAL_SERVER_ERROR, "An error occurred")
        );
    }
}
