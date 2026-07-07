import { db } from "@server/db";
import { apiKeys } from "@server/db";
import logger from "@server/logger";
import HttpCode from "@server/types/HttpCode";
import response from "@server/lib/response";
import { NextFunction, Request, Response } from "express";
import createHttpError from "http-errors";
import { z } from "zod";
import { fromError } from "zod-validation-error";
import { eq } from "drizzle-orm";

const querySchema = z.strictObject({
    limit: z
        .string()
        .optional()
        .default("1000")
        .transform(Number)
        .pipe(z.int().positive()),
    offset: z
        .string()
        .optional()
        .default("0")
        .transform(Number)
        .pipe(z.int().nonnegative())
});

function queryApiKeys() {
    return db
        .select({
            apiKeyId: apiKeys.apiKeyId,
            lastChars: apiKeys.lastChars,
            createdAt: apiKeys.createdAt,
            name: apiKeys.name
        })
        .from(apiKeys)
        .where(eq(apiKeys.isRoot, true));
}

export type ListRootApiKeysResponse = {
    apiKeys: Awaited<ReturnType<typeof queryApiKeys>>;
    pagination: { total: number; limit: number; offset: number };
};

export async function listRootApiKeys(
    req: Request,
    res: Response,
    next: NextFunction
): Promise<any> {
    try {
        const parsedQuery = querySchema.safeParse(req.query);
        if (!parsedQuery.success) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    fromError(parsedQuery.error)
                )
            );
        }
        const { limit, offset } = parsedQuery.data;

        const baseQuery = queryApiKeys();

        const apiKeysList = await baseQuery.limit(limit).offset(offset);

        return response<ListRootApiKeysResponse>(res, {
            data: {
                apiKeys: apiKeysList,
                pagination: {
                    total: apiKeysList.length,
                    limit,
                    offset
                }
            },
            success: true,
            error: false,
            message: "API keys retrieved successfully",
            status: HttpCode.OK
        });
    } catch (error) {
        logger.error(error);
        return next(
            createHttpError(HttpCode.INTERNAL_SERVER_ERROR, "An error occurred")
        );
    }
}
