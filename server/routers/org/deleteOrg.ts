import { Request, Response, NextFunction } from "express";
import { z } from "zod";
import response from "@server/lib/response";
import HttpCode from "@server/types/HttpCode";
import createHttpError from "http-errors";
import logger from "@server/logger";
import { fromError } from "zod-validation-error";
import { OpenAPITags, registry } from "@server/openApi";
import { deleteOrgById, sendTerminationMessages } from "@server/lib/deleteOrg";
import { db, Org, userOrgs, orgs } from "@server/db";
import { eq, and } from "drizzle-orm";

const deleteOrgSchema = z.strictObject({
    orgId: z.string()
});

export type DeleteOrgResponse = {};

registry.registerPath({
    method: "delete",
    path: "/org/{orgId}",
    description: "Delete an organization",
    tags: [OpenAPITags.Org],
    request: {
        params: deleteOrgSchema
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

export async function deleteOrg(
    req: Request,
    res: Response,
    next: NextFunction
): Promise<any> {
    try {
        const parsedParams = deleteOrgSchema.safeParse(req.params);
        if (!parsedParams.success) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    fromError(parsedParams.error).toString()
                )
            );
        }
        const { orgId } = parsedParams.data;

        let org: Org | undefined;

        if (req.user) {
            // Dashboard sessions may delete only an organization the user owns.
            const [data] = await db
                .select()
                .from(userOrgs)
                .innerJoin(orgs, eq(userOrgs.orgId, orgs.orgId))
                .where(
                    and(
                        eq(userOrgs.orgId, orgId),
                        eq(userOrgs.userId, req.user.userId)
                    )
                );

            if (!data) {
                return next(
                    createHttpError(
                        HttpCode.NOT_FOUND,
                        `Organization with ID ${orgId} not found`
                    )
                );
            }

            if (!data.userOrgs.isOwner) {
                return next(
                    createHttpError(
                        HttpCode.FORBIDDEN,
                        "Only organization owners can delete the organization"
                    )
                );
            }

            org = data.orgs;
        } else if (req.apiKey) {
            // Integration API requests carry no user session. The route is already
            // restricted by verifyApiKeyIsRoot and verifyApiKeyHasAction(deleteOrg).
            [org] = await db
                .select()
                .from(orgs)
                .where(eq(orgs.orgId, orgId))
                .limit(1);

            if (!org) {
                return next(
                    createHttpError(
                        HttpCode.NOT_FOUND,
                        `Organization with ID ${orgId} not found`
                    )
                );
            }
        } else {
            return next(
                createHttpError(HttpCode.UNAUTHORIZED, "Not authenticated")
            );
        }

        if (org.isBillingOrg) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    "Cannot delete a primary organization"
                )
            );
        }

        const result = await deleteOrgById(orgId);
        sendTerminationMessages(result);
        return response(res, {
            data: null,
            success: true,
            error: false,
            message: "Organization deleted successfully",
            status: HttpCode.OK
        });
    } catch (error) {
        if (createHttpError.isHttpError(error)) {
            return next(error);
        }
        logger.error(error);
        return next(
            createHttpError(
                HttpCode.INTERNAL_SERVER_ERROR,
                "An error occurred..."
            )
        );
    }
}
