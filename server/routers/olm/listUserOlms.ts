import { NextFunction, Request, Response } from "express";
import { db, currentFingerprint } from "@server/db";
import { olms } from "@server/db";
import { eq, count, desc } from "drizzle-orm";
import HttpCode from "@server/types/HttpCode";
import createHttpError from "http-errors";
import response from "@server/lib/response";
import { z } from "zod";
import { fromError } from "zod-validation-error";
import logger from "@server/logger";
import { OpenAPITags, registry } from "@server/openApi";
import { getUserDeviceName } from "@server/db/names";

const querySchema = z.object({
    limit: z
        .string()
        .optional()
        .default("1000")
        .transform(Number)
        .pipe(z.number().int().positive()),
    offset: z
        .string()
        .optional()
        .default("0")
        .transform(Number)
        .pipe(z.number().int().nonnegative())
});

const paramsSchema = z
    .object({
        userId: z.string()
    })
    .strict();

// registry.registerPath({
//     method: "delete",
//     path: "/user/{userId}/olms",
//     description: "List all olms for a user.",
//     tags: [OpenAPITags.User, OpenAPITags.Client],
//     request: {
//         query: querySchema,
//         params: paramsSchema
//     },
//     responses: {}
// });

export type ListUserOlmsResponse = {
    olms: Array<{
        olmId: string;
        dateCreated: string;
        version: string | null;
        name: string | null;
        clientId: number | null;
        userId: string | null;
        archived: boolean;
    }>;
    pagination: {
        total: number;
        limit: number;
        offset: number;
    };
};

export async function listUserOlms(
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
                    fromError(parsedQuery.error).toString()
                )
            );
        }

        const { limit, offset } = parsedQuery.data;

        const parsedParams = paramsSchema.safeParse(req.params);
        if (!parsedParams.success) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    fromError(parsedParams.error).toString()
                )
            );
        }

        const { userId } = parsedParams.data;

        // Get total count (including archived OLMs)
        const [totalCountResult] = await db
            .select({ count: count() })
            .from(olms)
            .where(eq(olms.userId, userId));

        const total = totalCountResult?.count || 0;

        // Get OLMs for the current user (including archived OLMs)
        const list = await db
            .select()
            .from(olms)
            .where(eq(olms.userId, userId))
            .leftJoin(
                currentFingerprint,
                eq(olms.olmId, currentFingerprint.olmId)
            )
            .orderBy(desc(olms.dateCreated))
            .limit(limit)
            .offset(offset);

        const userOlms = list.map((item) => {
            const model = item.currentFingerprint?.deviceModel || null;
            const newName = getUserDeviceName(model, item.olms.name);

            return {
                olmId: item.olms.olmId,
                dateCreated: item.olms.dateCreated,
                version: item.olms.version,
                name: newName,
                clientId: item.olms.clientId,
                userId: item.olms.userId,
                archived: item.olms.archived
            };
        });

        return response<ListUserOlmsResponse>(res, {
            data: {
                olms: userOlms,
                pagination: {
                    total,
                    limit,
                    offset
                }
            },
            success: true,
            error: false,
            message: "Olms retrieved successfully",
            status: HttpCode.OK
        });
    } catch (error) {
        logger.error(error);
        return next(
            createHttpError(
                HttpCode.INTERNAL_SERVER_ERROR,
                "Failed to list OLMs"
            )
        );
    }
}
