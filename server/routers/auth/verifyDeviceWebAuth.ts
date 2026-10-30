import { Request, Response, NextFunction } from "express";
import createHttpError from "http-errors";
import { z } from "zod";
import { fromError } from "zod-validation-error";
import HttpCode from "@server/types/HttpCode";
import logger from "@server/logger";
import { response } from "@server/lib/response";
import { db, deviceWebAuthCodes, sessions } from "@server/db";
import { eq, and, gt } from "drizzle-orm";
import { encodeHexLowerCase } from "@oslojs/encoding";
import { sha256 } from "@oslojs/crypto/sha2";
import { unauthorized } from "@server/auth/unauthorizedResponse";
import { getIosDeviceName, getMacDeviceName } from "@server/db/names";

const bodySchema = z
    .object({
        code: z.string().min(1, "Code is required"),
        verify: z.boolean().optional().default(false) // If false, just check and return metadata
    })
    .strict();

// Helper function to hash device code before querying database
function hashDeviceCode(code: string): string {
    return encodeHexLowerCase(sha256(new TextEncoder().encode(code)));
}

export type VerifyDeviceWebAuthBody = z.infer<typeof bodySchema>;

export type VerifyDeviceWebAuthResponse = {
    success: boolean;
    message: string;
    metadata?: {
        ip: string | null;
        city: string | null;
        deviceName: string | null;
        applicationName: string;
        createdAt: number;
    };
};

export async function verifyDeviceWebAuth(
    req: Request,
    res: Response,
    next: NextFunction
): Promise<any> {
    const { user, session } = req;
    if (!user || !session) {
        return next(createHttpError(HttpCode.UNAUTHORIZED, "Unauthorized"));
    }

    if (session.deviceAuthUsed) {
        return next(
            createHttpError(
                HttpCode.UNAUTHORIZED,
                "Device web auth code already used for this session"
            )
        );
    }

    if (!session.issuedAt) {
        return next(
            createHttpError(
                HttpCode.UNAUTHORIZED,
                "Session issuedAt timestamp missing"
            )
        );
    }

    // make sure sessions is not older than 5 minutes
    const now = Date.now();
    if (now - session.issuedAt > 5 * 60 * 1000) {
        return next(
            createHttpError(
                HttpCode.UNAUTHORIZED,
                "Session is too old to verify device web auth code"
            )
        );
    }

    const parsedBody = bodySchema.safeParse(req.body);

    if (!parsedBody.success) {
        return next(
            createHttpError(
                HttpCode.BAD_REQUEST,
                fromError(parsedBody.error).toString()
            )
        );
    }

    try {
        const { code, verify } = parsedBody.data;
        const now = Date.now();

        logger.debug("Verifying device web auth code:", { code });

        // Hash the code before querying
        const hashedCode = hashDeviceCode(code);

        // Find the code in the database that is not expired and not already verified
        const [deviceCode] = await db
            .select()
            .from(deviceWebAuthCodes)
            .where(
                and(
                    eq(deviceWebAuthCodes.code, hashedCode),
                    gt(deviceWebAuthCodes.expiresAt, now),
                    eq(deviceWebAuthCodes.verified, false)
                )
            )
            .limit(1);

        logger.debug("Device code lookup result:", deviceCode);

        if (!deviceCode) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    "Invalid, expired, or already verified code"
                )
            );
        }

        const deviceName =
            getMacDeviceName(deviceCode.deviceName) ||
            getIosDeviceName(deviceCode.deviceName) ||
            deviceCode.deviceName;

        // If verify is false, just return metadata without verifying
        if (!verify) {
            return response<VerifyDeviceWebAuthResponse>(res, {
                data: {
                    success: true,
                    message: "Code is valid",
                    metadata: {
                        ip: deviceCode.ip,
                        city: deviceCode.city,
                        deviceName: deviceName,
                        applicationName: deviceCode.applicationName,
                        createdAt: deviceCode.createdAt
                    }
                },
                success: true,
                error: false,
                message: "Code validation successful",
                status: HttpCode.OK
            });
        }

        // Update the code to mark it as verified and store the user who verified it
        await db
            .update(deviceWebAuthCodes)
            .set({
                verified: true,
                userId: req.user!.userId,
                approvingSessionId: session.sessionId
            })
            .where(eq(deviceWebAuthCodes.codeId, deviceCode.codeId));

        // Also update the session to mark that device auth was used
        await db
            .update(sessions)
            .set({
                deviceAuthUsed: true
            })
            .where(eq(sessions.sessionId, session.sessionId));

        return response<VerifyDeviceWebAuthResponse>(res, {
            data: {
                success: true,
                message: "Device code verified successfully"
            },
            success: true,
            error: false,
            message: "Device code verified successfully",
            status: HttpCode.OK
        });
    } catch (e) {
        logger.error(e);
        return next(
            createHttpError(
                HttpCode.INTERNAL_SERVER_ERROR,
                "Failed to verify device code"
            )
        );
    }
}
