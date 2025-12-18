/*
 * This file is part of a proprietary work.
 *
 * Copyright (c) 2025 Fossorial, Inc.
 * All rights reserved.
 *
 * This file is licensed under the Fossorial Commercial License.
 * You may not use this file except in compliance with the License.
 * Unauthorized use, copying, modification, or distribution is strictly prohibited.
 *
 * This file is not licensed under the AGPLv3.
 */

import { Request, Response, NextFunction } from "express";
import { z } from "zod";
import {
    db,
    LoginPageBranding,
    loginPageBranding,
    loginPageBrandingOrg
} from "@server/db";
import response from "@server/lib/response";
import HttpCode from "@server/types/HttpCode";
import createHttpError from "http-errors";
import logger from "@server/logger";
import { fromError } from "zod-validation-error";
import { eq, InferInsertModel } from "drizzle-orm";
import { getOrgTierData } from "#private/lib/billing";
import { TierId } from "@server/lib/billing/tiers";
import { build } from "@server/build";

const paramsSchema = z.strictObject({
    orgId: z.string()
});

const bodySchema = z.strictObject({
    logoUrl: z.url(),
    logoWidth: z.coerce.number<number>().min(1),
    logoHeight: z.coerce.number<number>().min(1),
    resourceTitle: z.string(),
    resourceSubtitle: z.string().optional(),
    orgTitle: z.string().optional(),
    orgSubtitle: z.string().optional(),
    primaryColor: z
        .string()
        .regex(/^#([0-9a-f]{6}|[0-9a-f]{3})$/i)
        .optional()
});

export type UpdateLoginPageBrandingBody = z.infer<typeof bodySchema>;

export async function upsertLoginPageBranding(
    req: Request,
    res: Response,
    next: NextFunction
): Promise<any> {
    try {
        const parsedBody = bodySchema.safeParse(req.body);
        if (!parsedBody.success) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    fromError(parsedBody.error).toString()
                )
            );
        }

        const parsedParams = paramsSchema.safeParse(req.params);
        if (!parsedParams.success) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    fromError(parsedParams.error).toString()
                )
            );
        }

        const { orgId } = parsedParams.data;

        if (build === "saas") {
            const { tier } = await getOrgTierData(orgId);
            const subscribed = tier === TierId.STANDARD;
            if (!subscribed) {
                return next(
                    createHttpError(
                        HttpCode.FORBIDDEN,
                        "This organization's current plan does not support this feature."
                    )
                );
            }
        }

        let updateData = parsedBody.data satisfies InferInsertModel<
            typeof loginPageBranding
        >;

        if (build !== "saas") {
            // org branding settings are only considered in the saas build
            const { orgTitle, orgSubtitle, ...rest } = updateData;
            updateData = rest;
        }

        const [existingLoginPageBranding] = await db
            .select()
            .from(loginPageBranding)
            .innerJoin(
                loginPageBrandingOrg,
                eq(
                    loginPageBrandingOrg.loginPageBrandingId,
                    loginPageBranding.loginPageBrandingId
                )
            )
            .where(eq(loginPageBrandingOrg.orgId, orgId));

        let updatedLoginPageBranding: LoginPageBranding;

        if (existingLoginPageBranding) {
            updatedLoginPageBranding = await db.transaction(async (tx) => {
                const [branding] = await tx
                    .update(loginPageBranding)
                    .set({ ...updateData })
                    .where(
                        eq(
                            loginPageBranding.loginPageBrandingId,
                            existingLoginPageBranding.loginPageBranding
                                .loginPageBrandingId
                        )
                    )
                    .returning();
                return branding;
            });
        } else {
            updatedLoginPageBranding = await db.transaction(async (tx) => {
                const [branding] = await tx
                    .insert(loginPageBranding)
                    .values({ ...updateData })
                    .returning();

                await tx.insert(loginPageBrandingOrg).values({
                    loginPageBrandingId: branding.loginPageBrandingId,
                    orgId: orgId
                });
                return branding;
            });
        }

        return response<LoginPageBranding>(res, {
            data: updatedLoginPageBranding,
            success: true,
            error: false,
            message: existingLoginPageBranding
                ? "Login page branding updated successfully"
                : "Login page branding created successfully",
            status: existingLoginPageBranding ? HttpCode.OK : HttpCode.CREATED
        });
    } catch (error) {
        logger.error(error);
        return next(
            createHttpError(HttpCode.INTERNAL_SERVER_ERROR, "An error occurred")
        );
    }
}
