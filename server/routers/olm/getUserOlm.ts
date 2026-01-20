import { NextFunction, Request, Response } from "express";
import { db } from "@server/db";
import { olms, clients, currentFingerprint } from "@server/db";
import { eq, and } from "drizzle-orm";
import HttpCode from "@server/types/HttpCode";
import createHttpError from "http-errors";
import response from "@server/lib/response";
import { z } from "zod";
import { fromError } from "zod-validation-error";
import logger from "@server/logger";
import { getUserDeviceName } from "@server/db/names";
// import { OpenAPITags, registry } from "@server/openApi";

const paramsSchema = z
    .object({
        userId: z.string(),
        olmId: z.string()
    })
    .strict();

const querySchema = z.object({
    orgId: z.string().optional()
});

// registry.registerPath({
//     method: "get",
//     path: "/user/{userId}/olm/{olmId}",
//     description: "Get an olm for a user.",
//     tags: [OpenAPITags.User, OpenAPITags.Client],
//     request: {
//         params: paramsSchema
//     },
//     responses: {}
// });

export async function getUserOlm(
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

        const parsedQuery = querySchema.safeParse(req.query);
        if (!parsedQuery.success) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    fromError(parsedQuery.error).toString()
                )
            );
        }

        const { olmId, userId } = parsedParams.data;
        const { orgId } = parsedQuery.data;

        const [result] = await db
            .select()
            .from(olms)
            .where(and(eq(olms.userId, userId), eq(olms.olmId, olmId)))
            .leftJoin(
                currentFingerprint,
                eq(olms.olmId, currentFingerprint.olmId)
            )
            .limit(1);

        if (!result || !result.olms) {
            return next(createHttpError(HttpCode.NOT_FOUND, "Olm not found"));
        }

        const olm = result.olms;

        // If orgId is provided and olm has a clientId, fetch the client to check blocked status
        let blocked: boolean | undefined;
        if (orgId && olm.clientId) {
            const [client] = await db
                .select({ blocked: clients.blocked })
                .from(clients)
                .where(
                    and(
                        eq(clients.clientId, olm.clientId),
                        eq(clients.orgId, orgId)
                    )
                )
                .limit(1);

            blocked = client?.blocked ?? false;
        }

        // Replace name with device name
        const model = result.currentFingerprint?.deviceModel || null;
        const newName = getUserDeviceName(model, olm.name);

        const responseData =
            blocked !== undefined
                ? { ...olm, name: newName, blocked }
                : { ...olm, name: newName };

        return response(res, {
            data: responseData,
            success: true,
            error: false,
            message: "Successfully retrieved olm",
            status: HttpCode.OK
        });
    } catch (error) {
        logger.error(error);
        return next(
            createHttpError(
                HttpCode.INTERNAL_SERVER_ERROR,
                "Failed to retrieve olm"
            )
        );
    }
}
