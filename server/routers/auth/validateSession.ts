import { Request, Response, NextFunction } from "express";
import { db, sessions, users } from "@server/db";
import { eq, and, gt } from "drizzle-orm";
import response from "@server/lib/response";
import HttpCode from "@server/types/HttpCode";
import logger from "@server/logger";
import { registry } from "@server/openApi";
import { OpenAPITags } from "@server/openApi";
import { z } from "zod";
import { sha256 } from "@oslojs/crypto/sha2";
import { encodeHexLowerCase } from "@oslojs/encoding";

export interface SessionValidationResponse {
    valid: boolean;
    userId?: string;
    email?: string;
    orgId?: string;
    expiresAt?: string;
}

registry.registerPath({
    method: "get",
    path: "/auth/session/validate",
    description:
        "Validate a session token. Used by Newt auth proxy to verify user sessions.",
    tags: [OpenAPITags.Auth],
    responses: {}
});

/**
 * Validate a session from cookie or Authorization header
 * This endpoint is called by Newt to validate user sessions for SSO protection
 */
export async function validateSession(
    req: Request,
    res: Response,
    next: NextFunction
): Promise<any> {
    try {
        // Get session token from cookie or header
        const sessionToken =
            req.cookies?.p_session ||
            req.headers.authorization?.replace("Bearer ", "");

        if (!sessionToken) {
            return response<SessionValidationResponse>(res, {
                data: { valid: false },
                success: true,
                error: false,
                message: "No session token provided",
                status: HttpCode.OK
            });
        }

        // Look up the session in the database
        // Session ID is the SHA256 hash of the session token
        const sessionId = encodeHexLowerCase(
            sha256(new TextEncoder().encode(sessionToken))
        );

        const now = new Date();
        const [session] = await db
            .select({
                sessionId: sessions.sessionId,
                userId: sessions.userId,
                expiresAt: sessions.expiresAt
            })
            .from(sessions)
            .where(
                and(
                    eq(sessions.sessionId, sessionId),
                    gt(sessions.expiresAt, now.getTime())
                )
            )
            .limit(1);

        if (!session) {
            return response<SessionValidationResponse>(res, {
                data: { valid: false },
                success: true,
                error: false,
                message: "Invalid or expired session",
                status: HttpCode.OK
            });
        }

        // Get user info
        const [user] = await db
            .select({
                email: users.email,
                userId: users.userId
            })
            .from(users)
            .where(eq(users.userId, session.userId))
            .limit(1);

        if (!user) {
            return response<SessionValidationResponse>(res, {
                data: { valid: false },
                success: true,
                error: false,
                message: "User not found",
                status: HttpCode.OK
            });
        }

        // Get user's primary org (for now, just return the session is valid)
        // TODO: Include org membership and resource access info

        return response<SessionValidationResponse>(res, {
            data: {
                valid: true,
                userId: user.userId,
                email: user.email || undefined,
                expiresAt: new Date(session.expiresAt).toISOString()
            },
            success: true,
            error: false,
            message: "Session valid",
            status: HttpCode.OK
        });
    } catch (error) {
        logger.error("Session validation error:", error);
        return response<SessionValidationResponse>(res, {
            data: { valid: false },
            success: false,
            error: true,
            message: "Session validation failed",
            status: HttpCode.INTERNAL_SERVER_ERROR
        });
    }
}
