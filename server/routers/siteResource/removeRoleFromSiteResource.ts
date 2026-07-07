import { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { db, siteResources } from "@server/db";
import { roleSiteResources, roles } from "@server/db";
import response from "@server/lib/response";
import HttpCode from "@server/types/HttpCode";
import createHttpError from "http-errors";
import logger from "@server/logger";
import { fromError } from "zod-validation-error";
import { eq, and } from "drizzle-orm";
import { OpenAPITags, registry } from "@server/openApi";
import {
    rebuildClientAssociationsFromSiteResource,
    isOrgRebuildRateLimited
} from "@server/lib/rebuildClientAssociations";

const removeRoleFromSiteResourceBodySchema = z
    .object({
        roleId: z.number().int().positive()
    })
    .strict();

const removeRoleFromSiteResourceParamsSchema = z
    .object({
        siteResourceId: z
            .string()
            .transform(Number)
            .pipe(z.number().int().positive())
    })
    .strict();

registry.registerPath({
    method: "post",
    path: "/site-resource/{siteResourceId}/roles/remove",
    description: "Remove a single role from a site resource.",
    tags: [OpenAPITags.PrivateResource, OpenAPITags.Role],
    request: {
        params: removeRoleFromSiteResourceParamsSchema,
        body: {
            content: {
                "application/json": {
                    schema: removeRoleFromSiteResourceBodySchema
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

export async function removeRoleFromSiteResource(
    req: Request,
    res: Response,
    next: NextFunction
): Promise<any> {
    try {
        const parsedBody = removeRoleFromSiteResourceBodySchema.safeParse(
            req.body
        );
        if (!parsedBody.success) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    fromError(parsedBody.error).toString()
                )
            );
        }

        const { roleId } = parsedBody.data;

        const parsedParams = removeRoleFromSiteResourceParamsSchema.safeParse(
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
                createHttpError(HttpCode.NOT_FOUND, "Site resource not found")
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

        // Check if the role is an admin role
        const [roleToCheck] = await db
            .select()
            .from(roles)
            .where(
                and(
                    eq(roles.roleId, roleId),
                    eq(roles.orgId, siteResource.orgId)
                )
            )
            .limit(1);

        if (!roleToCheck) {
            return next(
                createHttpError(
                    HttpCode.NOT_FOUND,
                    "Role not found or does not belong to the same organization"
                )
            );
        }

        if (roleToCheck.isAdmin) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    "Admin role cannot be removed from site resources"
                )
            );
        }

        // Check if role exists in site resource
        const existingEntry = await db
            .select()
            .from(roleSiteResources)
            .where(
                and(
                    eq(roleSiteResources.siteResourceId, siteResourceId),
                    eq(roleSiteResources.roleId, roleId)
                )
            );

        if (existingEntry.length === 0) {
            return next(
                createHttpError(
                    HttpCode.NOT_FOUND,
                    "Role not found in site resource"
                )
            );
        }

        await db
            .delete(roleSiteResources)
            .where(
                and(
                    eq(roleSiteResources.siteResourceId, siteResourceId),
                    eq(roleSiteResources.roleId, roleId)
                )
            );

        rebuildClientAssociationsFromSiteResource(siteResource).catch((e) => {
            logger.error(
                `Failed to rebuild client associations for site resource ${siteResourceId}. Error: ${e}`
            );
        });

        return response(res, {
            data: {},
            success: true,
            error: false,
            message: "Role removed from site resource successfully",
            status: HttpCode.OK
        });
    } catch (error) {
        logger.error(error);
        return next(
            createHttpError(HttpCode.INTERNAL_SERVER_ERROR, "An error occurred")
        );
    }
}
