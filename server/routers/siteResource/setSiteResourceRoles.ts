import { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { db, siteResources } from "@server/db";
import { roleSiteResources, roles } from "@server/db";
import response from "@server/lib/response";
import HttpCode from "@server/types/HttpCode";
import createHttpError from "http-errors";
import logger from "@server/logger";
import { fromError } from "zod-validation-error";
import { eq, and, ne, inArray } from "drizzle-orm";
import { OpenAPITags, registry } from "@server/openApi";
import {
    rebuildClientAssociationsFromSiteResource,
    isOrgRebuildRateLimited
} from "@server/lib/rebuildClientAssociations";

const setSiteResourceRolesBodySchema = z
    .object({
        roleIds: z.array(z.number().int().positive())
    })
    .strict();

const setSiteResourceRolesParamsSchema = z
    .object({
        siteResourceId: z
            .string()
            .transform(Number)
            .pipe(z.number().int().positive())
    })
    .strict();

registry.registerPath({
    method: "post",
    path: "/site-resource/{siteResourceId}/roles",
    description:
        "Set roles for a site resource. This will replace all existing roles.",
    tags: [OpenAPITags.PrivateResource, OpenAPITags.Role],
    request: {
        params: setSiteResourceRolesParamsSchema,
        body: {
            content: {
                "application/json": {
                    schema: setSiteResourceRolesBodySchema
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

export async function setSiteResourceRoles(
    req: Request,
    res: Response,
    next: NextFunction
): Promise<any> {
    try {
        const parsedBody = setSiteResourceRolesBodySchema.safeParse(req.body);
        if (!parsedBody.success) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    fromError(parsedBody.error).toString()
                )
            );
        }

        const { roleIds } = parsedBody.data;

        const parsedParams = setSiteResourceRolesParamsSchema.safeParse(
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

        const { siteResourceId } = parsedParams.data;

        // get the site resource
        const [siteResource] = await db
            .select()
            .from(siteResources)
            .where(eq(siteResources.siteResourceId, siteResourceId))
            .limit(1);

        if (!siteResource) {
            return next(
                createHttpError(
                    HttpCode.INTERNAL_SERVER_ERROR,
                    "Site resource not found"
                )
            );
        }

        if (await isOrgRebuildRateLimited(siteResource.orgId)) {
            return next(
                createHttpError(
                    HttpCode.TOO_MANY_REQUESTS,
                    "Too many concurrent rebuild operations for this organization. Please retry after a moment."
                )
            );
        }

        // Check if any of the roleIds are admin roles
        const rolesToCheck = await db
            .select()
            .from(roles)
            .where(
                and(
                    inArray(roles.roleId, roleIds),
                    eq(roles.orgId, siteResource.orgId)
                )
            );

        const hasAdminRole = rolesToCheck.some((role) => role.isAdmin);

        if (hasAdminRole) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    "Admin role cannot be assigned to site resources"
                )
            );
        }

        // Get all admin role IDs for this org to exclude from deletion
        const adminRoles = await db
            .select()
            .from(roles)
            .where(
                and(
                    eq(roles.isAdmin, true),
                    eq(roles.orgId, siteResource.orgId)
                )
            );
        const adminRoleIds = adminRoles.map((role) => role.roleId);

        await db.transaction(async (trx) => {
            if (adminRoleIds.length > 0) {
                await trx.delete(roleSiteResources).where(
                    and(
                        eq(roleSiteResources.siteResourceId, siteResourceId),
                        ne(roleSiteResources.roleId, adminRoleIds[0]) // delete all but the admin role
                    )
                );
            } else {
                await trx
                    .delete(roleSiteResources)
                    .where(
                        eq(roleSiteResources.siteResourceId, siteResourceId)
                    );
            }

            if (roleIds.length > 0) {
                await trx
                    .insert(roleSiteResources)
                    .values(
                        roleIds.map((roleId) => ({ roleId, siteResourceId }))
                    );
            }
        });

        rebuildClientAssociationsFromSiteResource(siteResource).catch((e) => {
            logger.error(
                `Failed to rebuild client associations for site resource ${siteResourceId}. Error: ${e}`
            );
        });

        return response(res, {
            data: {},
            success: true,
            error: false,
            message: "Roles set for site resource successfully",
            status: HttpCode.CREATED
        });
    } catch (error) {
        logger.error(error);
        return next(
            createHttpError(HttpCode.INTERNAL_SERVER_ERROR, "An error occurred")
        );
    }
}
