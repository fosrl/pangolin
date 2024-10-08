import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { db } from '@server/db';
import { resources } from '@server/db/schema';
import response from "@server/utils/response";
import HttpCode from '@server/types/HttpCode';
import createHttpError from 'http-errors';
import { ActionsEnum, checkUserActionPermission } from '@server/auth/actions';
import logger from '@server/logger';

const createResourceParamsSchema = z.object({
    siteId: z.number().int().positive(),
    orgId: z.number().int().positive(),
});

// Define Zod schema for request body validation
const createResourceSchema = z.object({
    name: z.string().min(1).max(255),
    subdomain: z.string().min(1).max(255).optional(),
});

export async function createResource(req: Request, res: Response, next: NextFunction): Promise<any> {
    try {
        // Validate request body
        const parsedBody = createResourceSchema.safeParse(req.body);
        if (!parsedBody.success) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    parsedBody.error.errors.map(e => e.message).join(', ')
                )
            );
        }

        const { name, subdomain } = parsedBody.data;

        // Validate request params
        const parsedParams = createResourceParamsSchema.safeParse(req.params);
        if (!parsedParams.success) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    parsedParams.error.errors.map(e => e.message).join(', ')
                )
            );
        }

        const { siteId, orgId } = parsedParams.data;

        // Check if the user has permission to list sites
        const hasPermission = await checkUserActionPermission(ActionsEnum.createResource, req);
        if (!hasPermission) {
            return next(createHttpError(HttpCode.FORBIDDEN, 'User does not have permission to list sites'));
        }

        // Generate a unique resourceId
        const resourceId = "subdomain" // TODO: create the subdomain here

        // Create new resource in the database
        const newResource = await db.insert(resources).values({
            resourceId,
            siteId,
            orgId,
            name,
            subdomain,
        }).returning();

        response(res, {
            data: newResource[0],
            success: true,
            error: false,
            message: "Resource created successfully",
            status: HttpCode.CREATED,
        });
    } catch (error) {
        logger.error(error);
        return next(createHttpError(HttpCode.INTERNAL_SERVER_ERROR, "An error occurred..."));
    }
}
