import { db, fingerprints, olms } from "@server/db";
import logger from "@server/logger";
import HttpCode from "@server/types/HttpCode";
import { and, eq } from "drizzle-orm";
import { NextFunction, Request, Response } from "express";
import response from "@server/lib/response";
import createHttpError from "http-errors";
import { z } from "zod";
import { fromError } from "zod-validation-error";
import { generateId } from "@server/auth/sessions/app";
import { hashPassword } from "@server/auth/password";

const paramsSchema = z
    .object({
        userId: z.string()
    })
    .strict();

const bodySchema = z
    .object({
        platformFingerprint: z.string()
    })
    .strict();

export async function recoverOlmWithFingerprint(
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

        const { userId } = parsedParams.data;

        const parsedBody = bodySchema.safeParse(req.body);
        if (!parsedBody.success) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    fromError(parsedBody.error).toString()
                )
            );
        }

        const { platformFingerprint } = parsedBody.data;

        const result = await db
            .select({
                olm: olms,
                fingerprint: fingerprints
            })
            .from(olms)
            .innerJoin(fingerprints, eq(fingerprints.olmId, olms.olmId))
            .where(
                and(
                    eq(olms.userId, userId),
                    eq(olms.archived, false),
                    eq(fingerprints.platformFingerprint, platformFingerprint)
                )
            )
            .orderBy(fingerprints.lastSeen);

        if (!result || result.length == 0) {
            return next(
                createHttpError(
                    HttpCode.NOT_FOUND,
                    "corresponding olm with this fingerprint not found"
                )
            );
        }

        if (result.length > 1) {
            return next(
                createHttpError(
                    HttpCode.CONFLICT,
                    "multiple matching fingerprints found, not resetting secrets"
                )
            );
        }

        const [{ olm: foundOlm }] = result;

        const newSecret = generateId(48);
        const newSecretHash = await hashPassword(newSecret);

        await db
            .update(olms)
            .set({
                secretHash: newSecretHash
            })
            .where(eq(olms.olmId, foundOlm.olmId));

        return response(res, {
            data: {
                olmId: foundOlm.olmId,
                secret: newSecret
            },
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
                "Failed to recover olm using provided fingerprint input"
            )
        );
    }
}
