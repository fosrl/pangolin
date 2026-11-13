/*
 * This file is part of a proprietary work.
 *
 * Copyright (c) 2025-2026 Fossorial, Inc.
 * All rights reserved.
 *
 * This file is licensed under the Fossorial Commercial License.
 * You may not use this file except in compliance with the License.
 * Unauthorized use, copying, modification, or distribution is strictly prohibited.
 *
 * This file is not licensed under the AGPLv3.
 */

import { Request, Response, NextFunction } from "express";
import HttpCode from "@server/types/HttpCode";
import createHttpError from "http-errors";
import logger from "@server/logger";
import { response as sendResponse } from "@server/lib/response";
import { getFirstString } from "@server/lib/requestParams";
import { z } from "zod";
import { fromError } from "zod-validation-error";
import { sendEmail } from "@server/emails";
import SupportEmail from "@server/emails/templates/SupportEmail";
import config from "@server/lib/config";
import { listOrgLicenses } from "#private/lib/billing/licenseApi";
import { tierHasHighAvailability } from "#private/lib/billing/selfHostedLicense";

const paramsSchema = z.strictObject({
    orgId: z.string().min(1)
});

const bodySchema = z.strictObject({
    body: z.string().min(1),
    subject: z.string().min(1).max(255),
    licenseKey: z.string().min(1)
});

/**
 * Software support request for a self-hosted instance. The license is looked up in
 * the org's own list (which scopes it to the org) and its details are added
 * to the email, so support can confirm the plan without asking.
 */
export async function sendLicenseSupportEmail(
    req: Request,
    res: Response,
    next: NextFunction
): Promise<any> {
    try {
        const parsedParams = paramsSchema.safeParse({
            orgId: getFirstString(req.params.orgId)
        });
        if (!parsedParams.success) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    fromError(parsedParams.error).toString()
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

        const { orgId } = parsedParams.data;
        const { body, subject, licenseKey } = parsedBody.data;
        const user = req.user!;

        if (!user?.email) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    "User does not have an email associated with their account"
                )
            );
        }

        const result = await listOrgLicenses(orgId);
        if (!result.ok) {
            throw new Error(
                `Fossorial API returned ${result.status} listing licenses for org ${orgId}: ${result.body}`
            );
        }

        const license = result.data.licenseKeys.find(
            (key) => key.licenseKey === licenseKey
        );
        if (!license) {
            return next(
                createHttpError(HttpCode.NOT_FOUND, "License key not found")
            );
        }

        // Community licenses don't include support
        if ((license.support ?? "community") === "community") {
            return next(
                createHttpError(
                    HttpCode.FORBIDDEN,
                    "This license does not include email or priority support"
                )
            );
        }

        try {
            await sendEmail(
                SupportEmail({
                    username: user.username,
                    email: user.email,
                    subject,
                    body,
                    license: {
                        orgId,
                        licenseKey: license.licenseKey,
                        instanceName: license.instanceName,
                        tier: license.tier,
                        type: license.type,
                        isValid: license.isValid,
                        expiresAt: license.expiresAt,
                        users: license.users,
                        sites: license.sites,
                        machines: license.machines,
                        support: license.support ?? "community",
                        highAvailability: tierHasHighAvailability(license.tier),
                        stripeSubscriptionId: license.stripeSubscriptionId
                    }
                }),
                {
                    name: user.email,
                    to: "support@pangolin.net",
                    replyTo: user.email,
                    from: config.getNoReplyEmail(),
                    subject: `Self-Hosted Support Request: ${subject}`
                }
            );
            return sendResponse(res, {
                data: {},
                success: true,
                error: false,
                message: "Sent license support email successfully",
                status: HttpCode.OK
            });
        } catch (e) {
            logger.error(e);
            return next(
                createHttpError(HttpCode.INTERNAL_SERVER_ERROR, `${e}`)
            );
        }
    } catch (error) {
        logger.error(error);
        return next(
            createHttpError(HttpCode.INTERNAL_SERVER_ERROR, "An error occurred")
        );
    }
}
