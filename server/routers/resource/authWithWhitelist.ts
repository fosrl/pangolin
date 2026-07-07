import { generateSessionToken } from "@server/auth/sessions/app";
import { db } from "@server/db";
import {
    orgs,
    resourceOtp,
    resources,
    resourceWhitelist,
    resourcePolicyWhiteList
} from "@server/db";
import HttpCode from "@server/types/HttpCode";
import response from "@server/lib/response";
import { eq, and } from "drizzle-orm";
import { NextFunction, Request, Response } from "express";
import createHttpError from "http-errors";
import { z } from "zod";
import { fromError } from "zod-validation-error";
import { createResourceSession } from "@server/auth/sessions/resource";
import { isValidOtp, sendResourceOtpEmail } from "@server/auth/resourceOtp";
import logger from "@server/logger";
import config from "@server/lib/config";
import { logAccessAudit } from "#dynamic/lib/logAccessAudit";

const authWithWhitelistBodySchema = z.strictObject({
    email: z.email().toLowerCase(),
    otp: z.string().optional()
});

const authWithWhitelistParamsSchema = z.strictObject({
    resourceId: z.coerce.number().int().positive()
});

export type AuthWithWhitelistResponse = {
    otpSent?: boolean;
    session?: string;
};

export async function authWithWhitelist(
    req: Request,
    res: Response,
    next: NextFunction
): Promise<any> {
    const parsedBody = authWithWhitelistBodySchema.safeParse(req.body);

    if (!parsedBody.success) {
        return next(
            createHttpError(
                HttpCode.BAD_REQUEST,
                fromError(parsedBody.error).toString()
            )
        );
    }

    const parsedParams = authWithWhitelistParamsSchema.safeParse(req.params);

    if (!parsedParams.success) {
        return next(
            createHttpError(
                HttpCode.BAD_REQUEST,
                fromError(parsedParams.error).toString()
            )
        );
    }

    const { resourceId } = parsedParams.data;
    const { email, otp } = parsedBody.data;

    try {
        // Fetch resource and org first
        const [resourceResult] = await db
            .select()
            .from(resources)
            .leftJoin(orgs, eq(orgs.orgId, resources.orgId))
            .where(eq(resources.resourceId, resourceId))
            .limit(1);

        const resource = resourceResult?.resources;
        const org = resourceResult?.orgs;

        if (!resource) {
            return next(
                createHttpError(HttpCode.BAD_REQUEST, "Resource does not exist")
            );
        }

        if (!org) {
            return next(
                createHttpError(HttpCode.BAD_REQUEST, "Resource does not exist")
            );
        }

        const wildcard = "*@" + email.split("@")[1];

        // Check shared policy whitelist first, then default (inline) policy whitelist
        let policyWhitelistEntry: {
            whitelistId: number;
            email: string;
        } | null = null;
        if (resource.resourcePolicyId) {
            const [exact] = await db
                .select()
                .from(resourcePolicyWhiteList)
                .where(
                    and(
                        eq(
                            resourcePolicyWhiteList.resourcePolicyId,
                            resource.resourcePolicyId
                        ),
                        eq(resourcePolicyWhiteList.email, email)
                    )
                )
                .limit(1);

            if (exact) {
                policyWhitelistEntry = exact;
            } else {
                logger.debug(
                    "Checking for wildcard email in shared policy: " + wildcard
                );
                const [wildcardMatch] = await db
                    .select()
                    .from(resourcePolicyWhiteList)
                    .where(
                        and(
                            eq(
                                resourcePolicyWhiteList.resourcePolicyId,
                                resource.resourcePolicyId
                            ),
                            eq(resourcePolicyWhiteList.email, wildcard)
                        )
                    )
                    .limit(1);
                if (wildcardMatch) policyWhitelistEntry = wildcardMatch;
            }
        }

        // Fall back to default (inline) policy whitelist if shared policy didn't match
        if (!policyWhitelistEntry && resource.defaultResourcePolicyId) {
            const [exact] = await db
                .select()
                .from(resourcePolicyWhiteList)
                .where(
                    and(
                        eq(
                            resourcePolicyWhiteList.resourcePolicyId,
                            resource.defaultResourcePolicyId
                        ),
                        eq(resourcePolicyWhiteList.email, email)
                    )
                )
                .limit(1);

            if (exact) {
                policyWhitelistEntry = exact;
            } else {
                logger.debug(
                    "Checking for wildcard email in default policy: " + wildcard
                );
                const [wildcardMatch] = await db
                    .select()
                    .from(resourcePolicyWhiteList)
                    .where(
                        and(
                            eq(
                                resourcePolicyWhiteList.resourcePolicyId,
                                resource.defaultResourcePolicyId
                            ),
                            eq(resourcePolicyWhiteList.email, wildcard)
                        )
                    )
                    .limit(1);
                if (wildcardMatch) policyWhitelistEntry = wildcardMatch;
            }
        }

        // Fall back to resource whitelist if not found in policy
        let resourceWhitelistEntry: {
            whitelistId: number;
            email: string;
        } | null = null;
        if (!policyWhitelistEntry) {
            const [exact] = await db
                .select()
                .from(resourceWhitelist)
                .where(
                    and(
                        eq(resourceWhitelist.resourceId, resourceId),
                        eq(resourceWhitelist.email, email)
                    )
                )
                .limit(1);

            if (exact) {
                resourceWhitelistEntry = exact;
            } else {
                logger.debug("Checking for wildcard email: " + wildcard);
                const [wildcardMatch] = await db
                    .select()
                    .from(resourceWhitelist)
                    .where(
                        and(
                            eq(resourceWhitelist.resourceId, resourceId),
                            eq(resourceWhitelist.email, wildcard)
                        )
                    )
                    .limit(1);
                if (wildcardMatch) resourceWhitelistEntry = wildcardMatch;
            }
        }

        const isPolicyWhitelist = !!policyWhitelistEntry;
        const whitelistedEmail = policyWhitelistEntry ?? resourceWhitelistEntry;

        if (!whitelistedEmail) {
            if (config.getRawConfig().app.log_failed_attempts) {
                logger.info(
                    `Email is not whitelisted. Email: ${email}. IP: ${req.ip}.`
                );
            }

            logAccessAudit({
                orgId: org.orgId,
                resourceId: resource.resourceId,
                action: false,
                type: "whitelistedEmail",
                metadata: { email },
                userAgent: req.headers["user-agent"],
                requestIp: req.ip
            });

            return next(
                createHttpError(
                    HttpCode.UNAUTHORIZED,
                    createHttpError(
                        HttpCode.BAD_REQUEST,
                        "Email is not whitelisted"
                    )
                )
            );
        }

        if (otp && email) {
            const isValidCode = await isValidOtp(
                email,
                resource.resourceId,
                otp
            );
            if (!isValidCode) {
                if (config.getRawConfig().app.log_failed_attempts) {
                    logger.info(
                        `Resource email otp incorrect. Resource ID: ${resource.resourceId}. Email: ${email}. IP: ${req.ip}.`
                    );
                }
                return next(
                    createHttpError(HttpCode.UNAUTHORIZED, "Incorrect OTP")
                );
            }

            await db
                .delete(resourceOtp)
                .where(
                    and(
                        eq(resourceOtp.email, email),
                        eq(resourceOtp.resourceId, resource.resourceId)
                    )
                );
        } else if (email) {
            try {
                await sendResourceOtpEmail(
                    email,
                    resource.resourceId,
                    resource.name,
                    org.name
                );
                return response<AuthWithWhitelistResponse>(res, {
                    data: { otpSent: true },
                    success: true,
                    error: false,
                    message: "Sent one-time otp to email address",
                    status: HttpCode.ACCEPTED
                });
            } catch (e) {
                logger.error(e);
                return next(
                    createHttpError(
                        HttpCode.INTERNAL_SERVER_ERROR,
                        "Failed to send one-time otp. Make sure the email address is correct and try again."
                    )
                );
            }
        } else {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    "Email is required for whitelist authentication"
                )
            );
        }

        const token = generateSessionToken();
        await createResourceSession({
            resourceId,
            token,
            whitelistId: isPolicyWhitelist
                ? null
                : whitelistedEmail.whitelistId,
            policyWhitelistId: isPolicyWhitelist
                ? whitelistedEmail.whitelistId
                : null,
            isRequestToken: true,
            expiresAt: Date.now() + 1000 * 30, // 30 seconds
            sessionLength: 1000 * 30,
            doNotExtend: true
        });

        logAccessAudit({
            orgId: org.orgId,
            resourceId: resource.resourceId,
            action: true,
            metadata: { email },
            type: "whitelistedEmail",
            userAgent: req.headers["user-agent"],
            requestIp: req.ip
        });

        return response<AuthWithWhitelistResponse>(res, {
            data: {
                session: token
            },
            success: true,
            error: false,
            message: "Authenticated with resource successfully",
            status: HttpCode.OK
        });
    } catch (e) {
        logger.error(e);
        return next(
            createHttpError(
                HttpCode.INTERNAL_SERVER_ERROR,
                "Failed to authenticate with resource"
            )
        );
    }
}
