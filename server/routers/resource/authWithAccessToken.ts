import { generateSessionToken } from "@server/auth/sessions/app";
import { db } from "@server/db";
import { Resource, resources } from "@server/db";
import HttpCode from "@server/types/HttpCode";
import response from "@server/lib/response";
import { eq } from "drizzle-orm";
import { NextFunction, Request, Response } from "express";
import createHttpError from "http-errors";
import { z } from "zod";
import { fromError } from "zod-validation-error";
import { createResourceSession } from "@server/auth/sessions/resource";
import logger from "@server/logger";
import { verifyResourceAccessToken } from "@server/auth/verifyResourceAccessToken";
import config from "@server/lib/config";
import stoi from "@server/lib/stoi";
import { logAccessAudit } from "#dynamic/lib/logAccessAudit";

const authWithAccessTokenBodySchema = z
    .object({
        accessToken: z.string(),
        accessTokenId: z.string().optional()
    })
    .strict();

const authWithAccessTokenParamsSchema = z
    .object({
        resourceId: z
            .string()
            .optional()
            .transform(stoi)
            .pipe(z.number().int().positive().optional())
    })
    .strict();

export type AuthWithAccessTokenResponse = {
    session?: string;
    redirectUrl?: string | null;
};

export async function authWithAccessToken(
    req: Request,
    res: Response,
    next: NextFunction
): Promise<any> {
    const parsedBody = authWithAccessTokenBodySchema.safeParse(req.body);

    if (!parsedBody.success) {
        return next(
            createHttpError(
                HttpCode.BAD_REQUEST,
                fromError(parsedBody.error).toString()
            )
        );
    }

    const parsedParams = authWithAccessTokenParamsSchema.safeParse(req.params);

    if (!parsedParams.success) {
        return next(
            createHttpError(
                HttpCode.BAD_REQUEST,
                fromError(parsedParams.error).toString()
            )
        );
    }

    const { resourceId } = parsedParams.data;
    const { accessToken, accessTokenId } = parsedBody.data;

    try {
        let valid;
        let tokenItem;
        let error;
        let resource: Resource | undefined;

        if (accessTokenId) {
            if (!resourceId) {
                return next(
                    createHttpError(
                        HttpCode.BAD_REQUEST,
                        "Resource ID is required"
                    )
                );
            }

            const [foundResource] = await db
                .select()
                .from(resources)
                .where(eq(resources.resourceId, resourceId))
                .limit(1);

            if (!foundResource) {
                return next(
                    createHttpError(HttpCode.NOT_FOUND, "Resource not found")
                );
            }

            const res = await verifyResourceAccessToken({
                accessTokenId,
                accessToken
            });

            valid = res.valid;
            tokenItem = res.tokenItem;
            error = res.error;
            resource = foundResource;
        } else {
            const res = await verifyResourceAccessToken({
                accessToken
            });

            valid = res.valid;
            tokenItem = res.tokenItem;
            error = res.error;
            resource = res.resource;
        }

        if (!tokenItem || !resource) {
            return next(
                createHttpError(
                    HttpCode.UNAUTHORIZED,
                    "Access token does not exist for resource"
                )
            );
        }

        if (!valid) {
            if (config.getRawConfig().app.log_failed_attempts) {
                logger.info(
                    `Resource access token invalid. Resource ID: ${resource.resourceId}. IP: ${req.ip}.`
                );
            }

            logAccessAudit({
                orgId: resource.orgId,
                resourceId: resource.resourceId,
                action: false,
                type: "accessToken",
                userAgent: req.headers["user-agent"],
                requestIp: req.ip
            });

            return next(
                createHttpError(
                    HttpCode.UNAUTHORIZED,
                    error || "Invalid access token"
                )
            );
        }

        const token = generateSessionToken();
        await createResourceSession({
            resourceId: resource.resourceId,
            token,
            accessTokenId: tokenItem.accessTokenId,
            isRequestToken: true,
            expiresAt: Date.now() + 1000 * 30, // 30 seconds
            sessionLength: 1000 * 30,
            doNotExtend: true
        });

        logAccessAudit({
            orgId: resource.orgId,
            resourceId: resource.resourceId,
            action: true,
            type: "accessToken",
            userAgent: req.headers["user-agent"],
            requestIp: req.ip
        });

        return response<AuthWithAccessTokenResponse>(res, {
            data: {
                session: token,
                redirectUrl: `${resource.ssl ? "https" : "http"}://${resource.fullDomain}`
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
