import { Request, Response, NextFunction } from "express";
import { z } from "zod";
import response from "@server/lib/response";
import HttpCode from "@server/types/HttpCode";
import createHttpError from "http-errors";
import logger from "@server/logger";
import { fromError } from "zod-validation-error";
import {
    getCachedStatusHistory,
    statusHistoryQuerySchema,
    StatusHistoryResponse
} from "@server/lib/statusHistory";

const resourceParamsSchema = z.object({
    resourceId: z.string().transform((v) => parseInt(v, 10))
});

export async function getResourceStatusHistory(
    req: Request,
    res: Response,
    next: NextFunction
): Promise<any> {
    try {
        const parsedParams = resourceParamsSchema.safeParse(req.params);
        if (!parsedParams.success) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    fromError(parsedParams.error).toString()
                )
            );
        }
        const parsedQuery = statusHistoryQuerySchema.safeParse(req.query);
        if (!parsedQuery.success) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    fromError(parsedQuery.error).toString()
                )
            );
        }

        const entityType = "resource";
        const entityId = parsedParams.data.resourceId;
        const { days, tzOffsetMinutes } = parsedQuery.data;

        const data = await getCachedStatusHistory(
            entityType,
            entityId,
            days,
            tzOffsetMinutes
        );

        return response<StatusHistoryResponse>(res, {
            data,
            success: true,
            error: false,
            message: "Status history retrieved successfully",
            status: HttpCode.OK
        });
    } catch (error) {
        logger.error(error);
        return next(
            createHttpError(HttpCode.INTERNAL_SERVER_ERROR, "An error occurred")
        );
    }
}