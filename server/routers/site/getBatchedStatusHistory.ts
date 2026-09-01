import response from "@server/lib/response";
import {
    getBatchedStatusHistory,
    type BatchedStatusHistoryResponse
} from "@server/lib/statusHistory";
import logger from "@server/logger";
import HttpCode from "@server/types/HttpCode";
import { NextFunction, Request, Response } from "express";
import createHttpError from "http-errors";
import { z } from "zod";
import { fromError } from "zod-validation-error";

const siteIdParamsSchema = z.object({
    days: z
        .string()
        .optional()
        .transform((v) => (v ? parseInt(v, 10) : 90)),
    // Minutes to add to UTC to get the requesting client's local time
    // (e.g. Australia/Sydney standard time is 600). Optional and
    // defaults to 0 (UTC) so older clients keep the prior behavior.
    tzOffsetMinutes: z
        .string()
        .optional()
        .transform((v) => (v ? parseInt(v, 10) : 0)),
    siteIds: z
        .preprocess((val) => {
            if (val === undefined || val === null || val === "") {
                return undefined;
            }
            const raw = Array.isArray(val) ? val : [val];
            const nums = raw
                .map((v) =>
                    typeof v === "string" ? parseInt(v, 10) : Number(v)
                )
                .filter((n) => Number.isInteger(n) && n > 0);
            const unique = [...new Set(nums)];
            return unique.length ? unique : undefined;
        }, z.array(z.number().int().positive()))
        .openapi({
            description: "Filter by siteIds (repeat query param)"
        })
});

export async function getBatchedSiteStatusHistory(
    req: Request,
    res: Response,
    next: NextFunction
): Promise<any> {
    try {
        const parsedQuery = siteIdParamsSchema.safeParse(req.query);
        if (!parsedQuery.success) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    fromError(parsedQuery.error).toString()
                )
            );
        }

        const entityType = "site";
        const { days, siteIds, tzOffsetMinutes } = parsedQuery.data;

        const data = await getBatchedStatusHistory(
            entityType,
            siteIds,
            days,
            tzOffsetMinutes
        );

        return response<BatchedStatusHistoryResponse>(res, {
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
