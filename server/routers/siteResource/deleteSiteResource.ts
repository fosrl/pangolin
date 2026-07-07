import { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { db, siteResources } from "@server/db";
import response from "@server/lib/response";
import HttpCode from "@server/types/HttpCode";
import createHttpError from "http-errors";
import { eq } from "drizzle-orm";
import { fromError } from "zod-validation-error";
import logger from "@server/logger";
import { OpenAPITags, registry } from "@server/openApi";
import {
    performDeleteSiteResource,
    runSiteResourceDeleteSideEffects
} from "@server/lib/deleteSiteResource";
import { LimitId } from "@server/lib/billing";
import { usageService } from "@server/lib/billing/usageService";

const deleteSiteResourceParamsSchema = z.strictObject({
    siteResourceId: z.coerce.number().int().positive()
});

export type DeleteSiteResourceResponse = {
    message: string;
};

registry.registerPath({
    method: "delete",
    path: "/site-resource/{siteResourceId}",
    description: "Delete a site resource.",
    tags: [OpenAPITags.PrivateResource],
    request: {
        params: deleteSiteResourceParamsSchema
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

export async function deleteSiteResource(
    req: Request,
    res: Response,
    next: NextFunction
): Promise<any> {
    try {
        const parsedParams = deleteSiteResourceParamsSchema.safeParse(
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

        const [existingSiteResource] = await db
            .select()
            .from(siteResources)
            .where(eq(siteResources.siteResourceId, siteResourceId))
            .limit(1);

        if (!existingSiteResource) {
            return next(
                createHttpError(HttpCode.NOT_FOUND, "Site resource not found")
            );
        }

        let removedSiteResource = null;

        await db.transaction(async (trx) => {
            removedSiteResource = await performDeleteSiteResource(
                siteResourceId,
                trx
            );
            if (removedSiteResource?.orgId) {
                await usageService.add(
                    removedSiteResource?.orgId,
                    LimitId.PRIVATE_RESOURCES,
                    -1,
                    trx
                );
            }
        });

        if (!removedSiteResource) {
            return next(
                createHttpError(HttpCode.NOT_FOUND, "Site resource not found")
            );
        }

        runSiteResourceDeleteSideEffects(removedSiteResource);

        return response(res, {
            data: { message: "Site resource deleted successfully" },
            success: true,
            error: false,
            message: "Site resource deleted successfully",
            status: HttpCode.OK
        });
    } catch (error) {
        logger.error("Error deleting site resource:", error);
        return next(
            createHttpError(
                HttpCode.INTERNAL_SERVER_ERROR,
                "Failed to delete site resource"
            )
        );
    }
}
