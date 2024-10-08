import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { db } from '@server/db';
import { resources } from '@server/db/schema';
import { eq } from 'drizzle-orm';
import response from "@server/utils/response";
import HttpCode from '@server/types/HttpCode';
import createHttpError from 'http-errors';
import { ActionsEnum, checkUserActionPermission } from '@server/auth/actions';
import logger from '@server/logger';

// Define Zod schema for request parameters validation
const updateResourceParamsSchema = z.object({
    resourceId: z.string().uuid()
});

// Define Zod schema for request body validation
const updateResourceBodySchema = z.object({
    name: z.string().min(1).max(255).optional(),
    subdomain: z.string().min(1).max(255).optional(),
}).refine(data => Object.keys(data).length > 0, {
    message: "At least one field must be provided for update"
});

export async function updateResource(req: Request, res: Response, next: NextFunction): Promise<any> {
    try {
        // Validate request parameters
        const parsedParams = updateResourceParamsSchema.safeParse(req.params);
        if (!parsedParams.success) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    parsedParams.error.errors.map(e => e.message).join(', ')
                )
            );
        }

        // Validate request body
        const parsedBody = updateResourceBodySchema.safeParse(req.body);
        if (!parsedBody.success) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    parsedBody.error.errors.map(e => e.message).join(', ')
                )
            );
        }

        const { resourceId } = parsedParams.data;
        const updateData = parsedBody.data;

        // Check if the user has permission to list sites
        const hasPermission = await checkUserActionPermission(ActionsEnum.updateResource, req);
        if (!hasPermission) {
            return next(createHttpError(HttpCode.FORBIDDEN, 'User does not have permission to list sites'));
        }

        // Update the resource in the database
        const updatedResource = await db.update(resources)
            .set(updateData)
            .where(eq(resources.resourceId, resourceId))
            .returning();

        if (updatedResource.length === 0) {
            return next(
                createHttpError(
                    HttpCode.NOT_FOUND,
                    `Resource with ID ${resourceId} not found`
                )
            );
        }

        return response(res, {
            data: updatedResource[0],
            success: true,
            error: false,
            message: "Resource updated successfully",
            status: HttpCode.OK,
        });
    } catch (error) {
        logger.error(error);
        return next(createHttpError(HttpCode.INTERNAL_SERVER_ERROR, "An error occurred..."));
    }
}
