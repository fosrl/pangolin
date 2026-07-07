import { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { db } from "@server/db";
import { roleSiteResources, roles } from "@server/db";
import { eq } from "drizzle-orm";
import response from "@server/lib/response";
import HttpCode from "@server/types/HttpCode";
import createHttpError from "http-errors";
import logger from "@server/logger";
import { fromError } from "zod-validation-error";
import { OpenAPITags, registry } from "@server/openApi";

const listSiteResourceRolesSchema = z
    .object({
        siteResourceId: z
            .string()
            .transform(Number)
            .pipe(z.number().int().positive())
    })
    .strict();

async function query(siteResourceId: number) {
    return await db
        .select({
            roleId: roles.roleId,
            name: roles.name,
            description: roles.description,
            isAdmin: roles.isAdmin
        })
        .from(roleSiteResources)
        .innerJoin(roles, eq(roleSiteResources.roleId, roles.roleId))
        .where(eq(roleSiteResources.siteResourceId, siteResourceId));
}

export type ListSiteResourceRolesResponse = {
    roles: NonNullable<Awaited<ReturnType<typeof query>>>;
};

registry.registerPath({
    method: "get",
    path: "/site-resource/{siteResourceId}/roles",
    description: "List all roles for a site resource.",
    tags: [OpenAPITags.PrivateResource, OpenAPITags.Role],
    request: {
        params: listSiteResourceRolesSchema
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

export async function listSiteResourceRoles(
    req: Request,
    res: Response,
    next: NextFunction
): Promise<any> {
    try {
        const parsedParams = listSiteResourceRolesSchema.safeParse(req.params);
        if (!parsedParams.success) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    fromError(parsedParams.error).toString()
                )
            );
        }

        const { siteResourceId } = parsedParams.data;

        const siteResourceRolesList = await query(siteResourceId);

        return response<ListSiteResourceRolesResponse>(res, {
            data: {
                roles: siteResourceRolesList
            },
            success: true,
            error: false,
            message: "Site resource roles retrieved successfully",
            status: HttpCode.OK
        });
    } catch (error) {
        logger.error(error);
        return next(
            createHttpError(HttpCode.INTERNAL_SERVER_ERROR, "An error occurred")
        );
    }
}
