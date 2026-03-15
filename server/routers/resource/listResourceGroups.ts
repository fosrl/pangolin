import { db, resourceGroups } from "@server/db";
import response from "@server/lib/response";
import HttpCode from "@server/types/HttpCode";
import { asc, eq } from "drizzle-orm";
import { NextFunction, Request, Response } from "express";
import createHttpError from "http-errors";
import { z } from "zod";
import { fromZodError } from "zod-validation-error";
import logger from "@server/logger";

const listResourceGroupsParamsSchema = z.strictObject({
    orgId: z.string()
});

export type ListResourceGroupsResponse = {
    groups: { groupId: number; name: string; sortOrder: number }[];
};

export async function listResourceGroups(
    req: Request,
    res: Response,
    next: NextFunction
): Promise<any> {
    try {
        const parsedParams = listResourceGroupsParamsSchema.safeParse(
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

        const { orgId } = parsedParams.data;

        const groups = await db
            .select({
                groupId: resourceGroups.groupId,
                name: resourceGroups.name,
                sortOrder: resourceGroups.sortOrder
            })
            .from(resourceGroups)
            .where(eq(resourceGroups.orgId, orgId))
            .orderBy(asc(resourceGroups.sortOrder), asc(resourceGroups.name));

        return response<ListResourceGroupsResponse>(res, {
            data: { groups },
            success: true,
            error: false,
            message: "Resource groups retrieved successfully",
            status: HttpCode.OK
        });
    } catch (error) {
        logger.error(error);
        return next(
            createHttpError(HttpCode.INTERNAL_SERVER_ERROR, "An error occurred")
        );
    }
}
