import { db, resourceGroups } from "@server/db";
import response from "@server/lib/response";
import HttpCode from "@server/types/HttpCode";
import { and, eq } from "drizzle-orm";
import { NextFunction, Request, Response } from "express";
import createHttpError from "http-errors";
import { z } from "zod";
import { fromZodError } from "zod-validation-error";
import logger from "@server/logger";

const updateResourceGroupParamsSchema = z.strictObject({
    orgId: z.string(),
    groupId: z.string().transform(Number).pipe(z.int().positive())
});

const updateResourceGroupBodySchema = z
    .strictObject({
        name: z.string().min(1).max(100).optional(),
        sortOrder: z.number().int().optional()
    })
    .refine((data) => Object.keys(data).length > 0, {
        message: "At least one field must be provided for update"
    });

export type UpdateResourceGroupResponse = {
    groupId: number;
    name: string;
    sortOrder: number;
};

export async function updateResourceGroup(
    req: Request,
    res: Response,
    next: NextFunction
): Promise<any> {
    try {
        const parsedParams = updateResourceGroupParamsSchema.safeParse(
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

        const parsedBody = updateResourceGroupBodySchema.safeParse(req.body);
        if (!parsedBody.success) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    fromZodError(parsedBody.error)
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

        const [updated] = await db
            .update(resourceGroups)
            .set(parsedBody.data)
            .where(eq(resourceGroups.groupId, groupId))
            .returning({
                groupId: resourceGroups.groupId,
                name: resourceGroups.name,
                sortOrder: resourceGroups.sortOrder
            });

        return response<UpdateResourceGroupResponse>(res, {
            data: updated,
            success: true,
            error: false,
            message: "Resource group updated successfully",
            status: HttpCode.OK
        });
    } catch (error) {
        logger.error(error);
        return next(
            createHttpError(HttpCode.INTERNAL_SERVER_ERROR, "An error occurred")
        );
    }
}
