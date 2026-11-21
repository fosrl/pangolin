import { db, resources } from "@server/db";
import response from "@server/lib/response";
import { EntraIdp, listEntraIdpsForOrg } from "@server/lib/idp/entraRdpIdps";
import logger from "@server/logger";
import HttpCode from "@server/types/HttpCode";
import { eq } from "drizzle-orm";
import { NextFunction, Request, Response } from "express";
import createHttpError from "http-errors";
import { z } from "zod";
import { fromError } from "zod-validation-error";

const paramsSchema = z.strictObject({
    resourceId: z.coerce.number<number>().int().positive()
});

export type ListResourceRdpEntraIdpsResponse = {
    idps: EntraIdp[];
};

export async function listResourceRdpEntraIdps(
    req: Request,
    res: Response,
    next: NextFunction
): Promise<any> {
    try {
        const parsedParams = paramsSchema.safeParse(req.params);
        if (!parsedParams.success) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    fromError(parsedParams.error).toString()
                )
            );
        }

        const [resource] = await db
            .select({ orgId: resources.orgId })
            .from(resources)
            .where(eq(resources.resourceId, parsedParams.data.resourceId))
            .limit(1);

        if (!resource) {
            return next(
                createHttpError(HttpCode.NOT_FOUND, "Resource not found")
            );
        }

        return response<ListResourceRdpEntraIdpsResponse>(res, {
            data: { idps: await listEntraIdpsForOrg(resource.orgId) },
            success: true,
            error: false,
            message: "Entra identity providers retrieved successfully",
            status: HttpCode.OK
        });
    } catch (error) {
        logger.error(error);
        return next(
            createHttpError(HttpCode.INTERNAL_SERVER_ERROR, "An error occurred")
        );
    }
}
