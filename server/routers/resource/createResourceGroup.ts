import { db, resourceGroups } from "@server/db";
import response from "@server/lib/response";
import HttpCode from "@server/types/HttpCode";
import { NextFunction, Request, Response } from "express";
import createHttpError from "http-errors";
import { z } from "zod";
import { fromZodError } from "zod-validation-error";
import logger from "@server/logger";

const createResourceGroupParamsSchema = z.strictObject({
    orgId: z.string()
});

const createResourceGroupBodySchema = z.strictObject({
    name: z.string().min(1).max(100)
});

export type CreateResourceGroupResponse = {
    groupId: number;
    name: string;
    sortOrder: number;
};

export async function createResourceGroup(
    req: Request,
    res: Response,
    next: NextFunction
): Promise<any> {
    try {
        const parsedParams = createResourceGroupParamsSchema.safeParse(
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

        const parsedBody = createResourceGroupBodySchema.safeParse(req.body);
        if (!parsedBody.success) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    fromZodError(parsedBody.error)
                )
            );
        }

        const { orgId } = parsedParams.data;
        const { name } = parsedBody.data;

        const [created] = await db
            .insert(resourceGroups)
            .values({ orgId, name, sortOrder: 0 })
            .returning({
                groupId: resourceGroups.groupId,
                name: resourceGroups.name,
                sortOrder: resourceGroups.sortOrder
            });

        return response<CreateResourceGroupResponse>(res, {
            data: created,
            success: true,
            error: false,
            message: "Resource group created successfully",
            status: HttpCode.CREATED
        });
    } catch (error) {
        logger.error(error);
        return next(
            createHttpError(HttpCode.INTERNAL_SERVER_ERROR, "An error occurred")
        );
    }
}
