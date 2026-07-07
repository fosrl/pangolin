import { NextFunction, Request, Response } from "express";
import { z } from "zod";
import { db, sites } from "@server/db";
import { eq } from "drizzle-orm";
import response from "@server/lib/response";
import HttpCode from "@server/types/HttpCode";
import createHttpError from "http-errors";
import logger from "@server/logger";
import { fromError } from "zod-validation-error";
import { OpenAPITags, registry } from "@server/openApi";

const resetOrgBandwidthParamsSchema = z.strictObject({
    orgId: z.string()
});

registry.registerPath({
    method: "post",
    path: "/org/{orgId}/reset-bandwidth",
    description: "Reset all sites in selected organization bandwidth counters.",
    tags: [OpenAPITags.Org, OpenAPITags.Site],
    request: {
        params: resetOrgBandwidthParamsSchema
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

export async function resetOrgBandwidth(
    req: Request,
    res: Response,
    next: NextFunction
): Promise<any> {
    try {
        const parsedParams = resetOrgBandwidthParamsSchema.safeParse(
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

        const { orgId } = parsedParams.data;

        const [site] = await db
            .select({ siteId: sites.siteId })
            .from(sites)
            .where(eq(sites.orgId, orgId))
            .limit(1);

        if (!site) {
            return next(
                createHttpError(
                    HttpCode.NOT_FOUND,
                    `No sites found in org ${orgId}`
                )
            );
        }

        await db
            .update(sites)
            .set({
                megabytesIn: 0,
                megabytesOut: 0
            })
            .where(eq(sites.orgId, orgId));

        return response(res, {
            data: {},
            success: true,
            error: false,
            message: "Sites bandwidth reset successfully",
            status: HttpCode.OK
        });
    } catch (error) {
        logger.error(error);
        return next(
            createHttpError(HttpCode.INTERNAL_SERVER_ERROR, "An error occurred")
        );
    }
}
