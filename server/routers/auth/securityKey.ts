import { Request, Response, NextFunction } from "express";
import createHttpError from "http-errors";
import HttpCode from "@server/types/HttpCode";
import { fromError } from "zod-validation-error";
import { z } from "zod";
import { db } from "@server/db";
import { User, securityKeys, users, webauthnChallenge } from "@server/db";
import { eq, and, lt } from "drizzle-orm";
import { response } from "@server/lib/response";
import logger from "@server/logger";
import {
    generateRegistrationOptions,
    verifyRegistrationResponse,
    generateAuthenticationOptions,
    verifyAuthenticationResponse
} from "@simplewebauthn/server";
import type {
    GenerateRegistrationOptionsOpts,
    GenerateAuthenticationOptionsOpts,
    AuthenticatorTransportFuture
} from "@simplewebauthn/server";
import { isoBase64URL } from "@simplewebauthn/server/helpers";
import config from "@server/lib/config";
import { UserType } from "@server/types/UserTypes";
import { verifyPassword } from "@server/auth/password";
import { unauthorized } from "@server/auth/unauthorizedResponse";
import { verifyTotpCode } from "@server/auth/totp";
import { getFirstString } from "@server/lib/requestParams";

// The RP ID is the domain name of your application
const rpID = (() => {
    const url = config.getRawConfig().app.dashboard_url
        ? new URL(config.getRawConfig().app.dashboard_url!)
        : undefined;
    // For localhost, we must use 'localhost' without port
    if (url?.hostname === "localhost" || !url) {
        return "localhost";
    }
    return url.hostname;
})();

const rpName = "Pangolin";
const origin = config.getRawConfig().app.dashboard_url || "localhost";

// Database-based challenge storage (replaces in-memory storage)
// Challenges are stored in the webauthnChallenge table with automatic expiration
// This supports clustered deployments and persists across server restarts

// Clean up expired challenges every 5 minutes
setInterval(
    async () => {
        try {
            const now = Date.now();
            await db
                .delete(webauthnChallenge)
                .where(lt(webauthnChallenge.expiresAt, now));
            // logger.debug("Cleaned up expired security key challenges");
        } catch (error) {
            logger.error(
                "Failed to clean up expired security key challenges",
                error
            );
        }
    },
    5 * 60 * 1000
);

// Helper functions for challenge management
async function storeChallenge(
    sessionId: string,
    challenge: string,
    securityKeyName?: string,
    userId?: string
) {
    const expiresAt = Date.now() + 5 * 60 * 1000; // 5 minutes

    // Delete any existing challenge for this session
    await db
        .delete(webauthnChallenge)
        .where(eq(webauthnChallenge.sessionId, sessionId));

    // Insert new challenge
    await db.insert(webauthnChallenge).values({
        sessionId,
        challenge,
        securityKeyName,
        userId,
        expiresAt
    });
}

async function getChallenge(sessionId: string) {
    const [challengeData] = await db
        .select()
        .from(webauthnChallenge)
        .where(eq(webauthnChallenge.sessionId, sessionId))
        .limit(1);

    if (!challengeData) {
        return null;
    }

    // Check if expired
    if (challengeData.expiresAt < Date.now()) {
        await db
            .delete(webauthnChallenge)
            .where(eq(webauthnChallenge.sessionId, sessionId));
        return null;
    }

    return challengeData;
}

async function clearChallenge(sessionId: string) {
    await db
        .delete(webauthnChallenge)
        .where(eq(webauthnChallenge.sessionId, sessionId));
}

export const registerSecurityKeyBody = z.strictObject({
    name: z.string().min(1),
    password: z.string().min(1),
    code: z.string().optional()
});

export const verifyRegistrationBody = z.strictObject({
    credential: z.any()
});

export const startAuthenticationBody = z.strictObject({
    email: z.email().optional()
});

export const verifyAuthenticationBody = z.strictObject({
    credential: z.any()
});

export const deleteSecurityKeyBody = z.strictObject({
    password: z.string().min(1),
    code: z.string().optional()
});

export async function startRegistration(
    req: Request,
    res: Response,
    next: NextFunction
): Promise<any> {
    const parsedBody = registerSecurityKeyBody.safeParse(req.body);

    if (!parsedBody.success) {
        return next(
            createHttpError(
                HttpCode.BAD_REQUEST,
                fromError(parsedBody.error).toString()
            )
        );
    }

    const { name, password, code } = parsedBody.data;
    const user = req.user as User;

    // Only allow internal users to use security keys
    if (user.type !== UserType.Internal) {
        return next(
            createHttpError(
                HttpCode.BAD_REQUEST,
                "Security keys are only available for internal users"
            )
        );
    }

    try {
        // Verify password
        const validPassword = await verifyPassword(
            password,
            user.passwordHash!
        );
        if (!validPassword) {
            return next(unauthorized());
        }

        // If user has 2FA enabled, require and verify the code
        if (user.twoFactorEnabled) {
            if (!code) {
                return response<{ codeRequested: boolean }>(res, {
                    data: { codeRequested: true },
                    success: true,
                    error: false,
                    message: "Two-factor authentication required",
                    status: HttpCode.ACCEPTED
                });
            }

            const validOTP = await verifyTotpCode(
                code,
                user.twoFactorSecret!,
                user.userId
            );

            if (!validOTP) {
                if (config.getRawConfig().app.log_failed_attempts) {
                    logger.info(
                        `Two-factor code incorrect. Email: ${user.email}. IP: ${req.ip}.`
                    );
                }
                return next(
                    createHttpError(
                        HttpCode.UNAUTHORIZED,
                        "The two-factor code you entered is incorrect"
                    )
                );
            }
        }

        // Get existing security keys for user
        const existingSecurityKeys = await db
            .select()
            .from(securityKeys)
            .where(eq(securityKeys.userId, user.userId));

        const excludeCredentials = existingSecurityKeys.map((key) => ({
            id: key.credentialId,
            transports: key.transports
                ? (JSON.parse(key.transports) as AuthenticatorTransportFuture[])
                : undefined
        }));

        const options: GenerateRegistrationOptionsOpts = {
            rpName,
            rpID,
            userID: isoBase64URL.toBuffer(user.userId),
            userName: user.email || user.username,
            attestationType: "none",
            excludeCredentials,
            authenticatorSelection: {
                residentKey: "preferred",
                userVerification: "preferred"
            }
        };

        const registrationOptions = await generateRegistrationOptions(options);

        // Store challenge in database
        await storeChallenge(
            req.session.sessionId,
            registrationOptions.challenge,
            name,
            user.userId
        );

        return response<typeof registrationOptions>(res, {
            data: registrationOptions,
            success: true,
            error: false,
            message: "Registration options generated successfully",
            status: HttpCode.OK
        });
    } catch (error) {
        logger.error(error);
        return next(
            createHttpError(
                HttpCode.INTERNAL_SERVER_ERROR,
                "Failed to start registration"
            )
        );
    }
}

export async function verifyRegistration(
    req: Request,
    res: Response,
    next: NextFunction
): Promise<any> {
    const parsedBody = verifyRegistrationBody.safeParse(req.body);

    if (!parsedBody.success) {
        return next(
            createHttpError(
                HttpCode.BAD_REQUEST,
                fromError(parsedBody.error).toString()
            )
        );
    }

    const { credential } = parsedBody.data;
    const user = req.user as User;

    // Only allow internal users to use security keys
    if (user.type !== UserType.Internal) {
        return next(
            createHttpError(
                HttpCode.BAD_REQUEST,
                "Security keys are only available for internal users"
            )
        );
    }

    try {
        // Get challenge from database
        const challengeData = await getChallenge(req.session.sessionId);

        if (!challengeData) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    "No challenge found in session or challenge expired"
                )
            );
        }

        const verification = await verifyRegistrationResponse({
            response: credential,
            expectedChallenge: challengeData.challenge,
            expectedOrigin: origin,
            expectedRPID: rpID,
            requireUserVerification: false
        });

        const { verified, registrationInfo } = verification;

        if (!verified || !registrationInfo) {
            return next(
                createHttpError(HttpCode.BAD_REQUEST, "Verification failed")
            );
        }

        // Store the security key in the database
        await db.insert(securityKeys).values({
            credentialId: registrationInfo.credential.id,
            userId: user.userId,
            publicKey: isoBase64URL.fromBuffer(
                registrationInfo.credential.publicKey
            ),
            signCount: registrationInfo.credential.counter || 0,
            transports: registrationInfo.credential.transports
                ? JSON.stringify(registrationInfo.credential.transports)
                : null,
            name: challengeData.securityKeyName,
            lastUsed: new Date().toISOString(),
            dateCreated: new Date().toISOString()
        });

        // Clear challenge data
        await clearChallenge(req.session.sessionId);

        return response<null>(res, {
            data: null,
            success: true,
            error: false,
            message: "Security key registered successfully",
            status: HttpCode.OK
        });
    } catch (error) {
        logger.error(error);
        return next(
            createHttpError(
                HttpCode.INTERNAL_SERVER_ERROR,
                "Failed to verify registration"
            )
        );
    }
}

export async function listSecurityKeys(
    req: Request,
    res: Response,
    next: NextFunction
): Promise<any> {
    const user = req.user as User;

    // Only allow internal users to use security keys
    if (user.type !== UserType.Internal) {
        return next(
            createHttpError(
                HttpCode.BAD_REQUEST,
                "Security keys are only available for internal users"
            )
        );
    }

    try {
        const userSecurityKeys = await db
            .select()
            .from(securityKeys)
            .where(eq(securityKeys.userId, user.userId));

        return response<typeof userSecurityKeys>(res, {
            data: userSecurityKeys,
            success: true,
            error: false,
            message: "Security keys retrieved successfully",
            status: HttpCode.OK
        });
    } catch (error) {
        logger.error(error);
        return next(
            createHttpError(
                HttpCode.INTERNAL_SERVER_ERROR,
                "Failed to retrieve security keys"
            )
        );
    }
}

export async function deleteSecurityKey(
    req: Request,
    res: Response,
    next: NextFunction
): Promise<any> {
    const encodedCredentialId = getFirstString(req.params.credentialId);
    if (!encodedCredentialId) {
        return next(
            createHttpError(HttpCode.BAD_REQUEST, "Invalid credential ID")
        );
    }
    const credentialId = decodeURIComponent(encodedCredentialId);
    const user = req.user as User;

    const parsedBody = deleteSecurityKeyBody.safeParse(req.body);

    if (!parsedBody.success) {
        return next(
            createHttpError(
                HttpCode.BAD_REQUEST,
                fromError(parsedBody.error).toString()
            )
        );
    }

    const { password, code } = parsedBody.data;

    // Only allow internal users to use security keys
    if (user.type !== UserType.Internal) {
        return next(
            createHttpError(
                HttpCode.BAD_REQUEST,
                "Security keys are only available for internal users"
            )
        );
    }

    try {
        // Verify password
        const validPassword = await verifyPassword(
            password,
            user.passwordHash!
        );
        if (!validPassword) {
            return next(unauthorized());
        }

        // If user has 2FA enabled, require and verify the code
        if (user.twoFactorEnabled) {
            if (!code) {
                return response<{ codeRequested: boolean }>(res, {
                    data: { codeRequested: true },
                    success: true,
                    error: false,
                    message: "Two-factor authentication required",
                    status: HttpCode.ACCEPTED
                });
            }

            const validOTP = await verifyTotpCode(
                code,
                user.twoFactorSecret!,
                user.userId
            );

            if (!validOTP) {
                if (config.getRawConfig().app.log_failed_attempts) {
                    logger.info(
                        `Two-factor code incorrect. Email: ${user.email}. IP: ${req.ip}.`
                    );
                }
                return next(
                    createHttpError(
                        HttpCode.UNAUTHORIZED,
                        "The two-factor code you entered is incorrect"
                    )
                );
            }
        }

        await db
            .delete(securityKeys)
            .where(
                and(
                    eq(securityKeys.credentialId, credentialId),
                    eq(securityKeys.userId, user.userId)
                )
            );

        return response<null>(res, {
            data: null,
            success: true,
            error: false,
            message: "Security key deleted successfully",
            status: HttpCode.OK
        });
    } catch (error) {
        logger.error(error);
        return next(
            createHttpError(
                HttpCode.INTERNAL_SERVER_ERROR,
                "Failed to delete security key"
            )
        );
    }
}

export async function startAuthentication(
    req: Request,
    res: Response,
    next: NextFunction
): Promise<any> {
    const parsedBody = startAuthenticationBody.safeParse(req.body);

    if (!parsedBody.success) {
        return next(
            createHttpError(
                HttpCode.BAD_REQUEST,
                fromError(parsedBody.error).toString()
            )
        );
    }

    const { email } = parsedBody.data;

    try {
        let allowCredentials;
        let userId;

        // If email is provided, get security keys for that specific user
        if (email) {
            const [user] = await db
                .select()
                .from(users)
                .where(eq(users.email, email))
                .limit(1);

            if (!user || user.type !== UserType.Internal) {
                return next(
                    createHttpError(HttpCode.BAD_REQUEST, "Invalid credentials")
                );
            }

            userId = user.userId;

            const userSecurityKeys = await db
                .select()
                .from(securityKeys)
                .where(eq(securityKeys.userId, user.userId));

            if (userSecurityKeys.length === 0) {
                return next(
                    createHttpError(
                        HttpCode.BAD_REQUEST,
                        "No security keys registered for this user"
                    )
                );
            }

            allowCredentials = userSecurityKeys.map((key) => ({
                id: key.credentialId,
                transports: key.transports
                    ? (JSON.parse(
                          key.transports
                      ) as AuthenticatorTransportFuture[])
                    : undefined
            }));
        }

        const options: GenerateAuthenticationOptionsOpts = {
            rpID,
            allowCredentials,
            userVerification: "preferred"
        };

        const authenticationOptions =
            await generateAuthenticationOptions(options);

        // Generate a temporary session ID for unauthenticated users
        const tempSessionId = email
            ? `temp_${email}_${Date.now()}`
            : `temp_${Date.now()}`;

        // Store challenge in database
        await storeChallenge(
            tempSessionId,
            authenticationOptions.challenge,
            undefined,
            userId
        );

        return response(res, {
            data: { ...authenticationOptions, tempSessionId },
            success: true,
            error: false,
            message: "Authentication options generated",
            status: HttpCode.OK
        });
    } catch (error) {
        logger.error(error);
        return next(
            createHttpError(
                HttpCode.INTERNAL_SERVER_ERROR,
                "Failed to generate authentication options"
            )
        );
    }
}

export async function verifyAuthentication(
    req: Request,
    res: Response,
    next: NextFunction
): Promise<any> {
    const parsedBody = verifyAuthenticationBody.safeParse(req.body);

    if (!parsedBody.success) {
        return next(
            createHttpError(
                HttpCode.BAD_REQUEST,
                fromError(parsedBody.error).toString()
            )
        );
    }

    const { credential } = parsedBody.data;
    const tempSessionId = req.headers["x-temp-session-id"] as string;

    if (!tempSessionId) {
        return next(
            createHttpError(
                HttpCode.BAD_REQUEST,
                "Your session information is missing. This might happen if you've been inactive for too long or if your browser cleared temporary data. Please start the sign-in process again."
            )
        );
    }

    try {
        // Get challenge from database
        const challengeData = await getChallenge(tempSessionId);

        if (!challengeData) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    "Your sign-in session has expired. For security reasons, you have 5 minutes to complete the authentication process. Please try signing in again."
                )
            );
        }

        // Find the security key in database
        const credentialId = credential.id;
        const [securityKey] = await db
            .select()
            .from(securityKeys)
            .where(eq(securityKeys.credentialId, credentialId))
            .limit(1);

        if (!securityKey) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    "We couldn't verify your security key. This might happen if your device isn't compatible or if the security key was removed too quickly. Please try again and keep your security key connected until the process completes."
                )
            );
        }

        // Get the user
        const [user] = await db
            .select()
            .from(users)
            .where(eq(users.userId, securityKey.userId))
            .limit(1);

        if (!user || user.type !== UserType.Internal) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    "User not found or not authorized for security key authentication"
                )
            );
        }

        const verification = await verifyAuthenticationResponse({
            response: credential,
            expectedChallenge: challengeData.challenge,
            expectedOrigin: origin,
            expectedRPID: rpID,
            credential: {
                id: securityKey.credentialId,
                publicKey: isoBase64URL.toBuffer(securityKey.publicKey),
                counter: securityKey.signCount,
                transports: securityKey.transports
                    ? (JSON.parse(
                          securityKey.transports
                      ) as AuthenticatorTransportFuture[])
                    : undefined
            },
            requireUserVerification: false
        });

        const { verified, authenticationInfo } = verification;

        if (!verified) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    "Authentication failed. This could happen if your security key wasn't recognized or was removed too early. Please ensure your security key is properly connected and try again."
                )
            );
        }

        // Update sign count
        await db
            .update(securityKeys)
            .set({
                signCount: authenticationInfo.newCounter,
                lastUsed: new Date().toISOString()
            })
            .where(eq(securityKeys.credentialId, credentialId));

        // Create session for the user
        const { createSession, generateSessionToken, serializeSessionCookie } =
            await import("@server/auth/sessions/app");
        const token = generateSessionToken();
        const session = await createSession(token, user.userId);
        const isSecure = req.protocol === "https";
        const cookie = serializeSessionCookie(
            token,
            isSecure,
            new Date(session.expiresAt)
        );

        res.setHeader("Set-Cookie", cookie);

        // Clear challenge data
        await clearChallenge(tempSessionId);

        return response<null>(res, {
            data: null,
            success: true,
            error: false,
            message: "Authentication successful",
            status: HttpCode.OK
        });
    } catch (error) {
        logger.error(error);
        return next(
            createHttpError(
                HttpCode.INTERNAL_SERVER_ERROR,
                "Failed to verify authentication"
            )
        );
    }
}
