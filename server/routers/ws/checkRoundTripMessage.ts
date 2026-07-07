import { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { db, roundTripMessageTracker } from "@server/db";
import response from "@server/lib/response";
import HttpCode from "@server/types/HttpCode";
import createHttpError from "http-errors";
import logger from "@server/logger";
import { fromError } from "zod-validation-error";
import { eq } from "drizzle-orm";
import { OpenAPITags, registry } from "@server/openApi";

const checkRoundTripMessageParamsSchema = z
    .object({
        messageId: z
            .string()
            .transform(Number)
            .pipe(z.number().int().positive())
    })
    .strict();

// registry.registerPath({
//     method: "get",
//     path: "/ws/round-trip-message/{messageId}",
//     description:
//         "Check if a round trip message has been completed by checking the roundTripMessageTracker table",
//     tags: [OpenAPITags.WebSocket],
//     request: {
//         params: checkRoundTripMessageParamsSchema
//     },
// responses: {
// 200: {
// description: "Successful response",
// content: {
// "application/json": {
// schema: z.object({
// data: z.record(z.string(), z.any()).nullable(),
// success: z.boolean(),
// error: z.boolean(),
// message: z.string(),
// status: z.number()
// })
// }
// }
// }
// }
// });

export async function checkRoundTripMessage(
    req: Request,
    res: Response,
    next: NextFunction
): Promise<any> {
    try {
        const parsedParams = checkRoundTripMessageParamsSchema.safeParse(
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

        const { messageId } = parsedParams.data;

        // Get the round trip message from the tracker
        const [message] = await db
            .select()
            .from(roundTripMessageTracker)
            .where(eq(roundTripMessageTracker.messageId, messageId))
            .limit(1);

        if (!message) {
            return next(
                createHttpError(HttpCode.NOT_FOUND, "Message not found")
            );
        }

        return response(res, {
            data: {
                messageId: message.messageId,
                complete: message.complete,
                sentAt: message.sentAt,
                receivedAt: message.receivedAt,
                error: message.error
            },
            success: true,
            error: false,
            message: "Round trip message status retrieved successfully",
            status: HttpCode.OK
        });
    } catch (error) {
        logger.error(error);
        return next(
            createHttpError(HttpCode.INTERNAL_SERVER_ERROR, "An error occurred")
        );
    }
}
