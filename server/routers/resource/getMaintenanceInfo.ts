
import { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { db } from "@server/db";
import { resources } from "@server/db";
import { eq } from "drizzle-orm";
import response from "@server/lib/response";
import HttpCode from "@server/types/HttpCode";
import createHttpError from "http-errors";
import { fromError } from "zod-validation-error";
import logger from "@server/logger";
import { OpenAPITags, registry } from "@server/openApi";

const getMaintenanceInfoSchema = z
    .object({
        fullDomain: z.string().min(1, "Domain is required")
    })
    .strict();

async function query(fullDomain: string) {
    const [res] = await db
        .select({
            resourceId: resources.resourceId,
            name: resources.name,
            fullDomain: resources.fullDomain,
            maintenanceModeEnabled: resources.maintenanceModeEnabled,
            maintenanceModeType: resources.maintenanceModeType,
            maintenanceTitle: resources.maintenanceTitle,
            maintenanceMessage: resources.maintenanceMessage,
            maintenanceEstimatedTime: resources.maintenanceEstimatedTime
        })
        .from(resources)
        .where(eq(resources.fullDomain, fullDomain))
        .limit(1);
    return res;
}

export type GetMaintenanceInfoResponse = NonNullable<
    Awaited<ReturnType<typeof query>>
>;

registry.registerPath({
    method: "get",
    path: "/maintenance/info",
    description: "Get maintenance information for a resource by domain.",
    tags: [OpenAPITags.Resource],
    request: {
        query: z.object({
            fullDomain: z.string()
        })
    },
    responses: {
        200: {
            description: "Maintenance information retrieved successfully"
        },
        404: {
            description: "Resource not found"
        }
    }
});

export async function getMaintenanceInfo(
    req: Request,
    res: Response,
    next: NextFunction
): Promise<any> {
    try {
        const parsedQuery = getMaintenanceInfoSchema.safeParse(req.query);
        if (!parsedQuery.success) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    fromError(parsedQuery.error).toString()
                )
            );
        }

        const { fullDomain } = parsedQuery.data;

        const maintenanceInfo = await query(fullDomain);

        if (!maintenanceInfo) {
            return next(
                createHttpError(HttpCode.NOT_FOUND, "Resource not found")
            );
        }

        return response<GetMaintenanceInfoResponse>(res, {
            data: maintenanceInfo,
            success: true,
            error: false,
            message: "Maintenance information retrieved successfully",
            status: HttpCode.OK
        });
    } catch (error) {
        logger.error(error);
        return next(
            createHttpError(
                HttpCode.INTERNAL_SERVER_ERROR,
                "An error occurred while retrieving maintenance information"
            )
        );
    }
}
