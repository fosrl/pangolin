import { Request, Response, NextFunction } from "express";
import createHttpError from "http-errors";
import { z } from "zod";
import { fromError } from "zod-validation-error";
import HttpCode from "@server/types/HttpCode";
import logger from "@server/logger";
import { response } from "@server/lib/response";
import { db, deviceWebAuthCodes } from "@server/db";
import { eq, and, gt } from "drizzle-orm";
import {
    createSession,
    generateSessionToken,
    invalidateSession
} from "@server/auth/sessions/app";
import { inheritIdpGrant } from "@server/auth/sessions/idpRevalidation";
import { encodeHexLowerCase } from "@oslojs/encoding";
import { sha256 } from "@oslojs/crypto/sha2";
import { stripPortFromHost } from "@server/lib/ip";

const paramsSchema = z.object({
    code: z.string().min(1, "Code is required")
});

export type PollDeviceWebAuthParams = z.infer<typeof paramsSchema>;

// Helper function to hash device code before querying database
function hashDeviceCode(code: string): string {
    return encodeHexLowerCase(sha256(new TextEncoder().encode(code)));
}

export type PollDeviceWebAuthResponse = {
    verified: boolean;
    token?: string;
};

export async function pollDeviceWebAuth(
    req: Request,
    res: Response,
    next: NextFunction
): Promise<any> {
    const parsedParams = paramsSchema.safeParse(req.params);

    if (!parsedParams.success) {
        return next(
            createHttpError(
                HttpCode.BAD_REQUEST,
                fromError(parsedParams.error).toString()
            )
        );
    }

    try {
        const { code } = parsedParams.data;
        const now = Date.now();
        const requestIp = req.ip ? stripPortFromHost(req.ip) : undefined;

        // Hash the code before querying
        const hashedCode = hashDeviceCode(code);

        // Find the code in the database
        const [deviceCode] = await db
            .select()
            .from(deviceWebAuthCodes)
            .where(eq(deviceWebAuthCodes.code, hashedCode))
            .limit(1);

        if (!deviceCode) {
            return response<PollDeviceWebAuthResponse>(res, {
                data: {
                    verified: false
                },
                success: true,
                error: false,
                message: "Code not found",
                status: HttpCode.OK
            });
        }

        // Check if code is expired
        if (deviceCode.expiresAt <= now) {
            return response<PollDeviceWebAuthResponse>(res, {
                data: {
                    verified: false
                },
                success: true,
                error: false,
                message: "Code expired",
                status: HttpCode.OK
            });
        }

        // Check if code is verified
        if (!deviceCode.verified) {
            return response<PollDeviceWebAuthResponse>(res, {
                data: {
                    verified: false
                },
                success: true,
                error: false,
                message: "Code not yet verified",
                status: HttpCode.OK
            });
        }

        // Check if userId is set (should be set when verified)
        if (!deviceCode.userId) {
            logger.error("Device code is verified but userId is missing", {
                codeId: deviceCode.codeId
            });
            return next(
                createHttpError(
                    HttpCode.INTERNAL_SERVER_ERROR,
                    "Invalid code state"
                )
            );
        }

        // Generate session token
        const token = generateSessionToken();
        const sess = await createSession(token, deviceCode.userId);
        if (
            deviceCode.approvingSessionId &&
            !(await inheritIdpGrant(
                deviceCode.approvingSessionId,
                sess.sessionId
            ))
        ) {
            await invalidateSession(sess.sessionId);
            await db
                .delete(deviceWebAuthCodes)
                .where(eq(deviceWebAuthCodes.codeId, deviceCode.codeId));
            return next(
                createHttpError(
                    HttpCode.UNAUTHORIZED,
                    "The login that approved this device is no longer valid"
                )
            );
        }

        // Delete the code after successful exchange for a token
        await db
            .delete(deviceWebAuthCodes)
            .where(eq(deviceWebAuthCodes.codeId, deviceCode.codeId));

        return response<PollDeviceWebAuthResponse>(res, {
            data: {
                verified: true,
                token
            },
            success: true,
            error: false,
            message: "Code verified and session created",
            status: HttpCode.OK
        });
    } catch (e) {
        logger.error(e);
        return next(
            createHttpError(
                HttpCode.INTERNAL_SERVER_ERROR,
                "Failed to poll device code"
            )
        );
    }
}
