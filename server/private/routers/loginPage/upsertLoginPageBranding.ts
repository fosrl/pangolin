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
import { build } from "@server/build";
import { validateLocalPath } from "@app/lib/validateLocalPath";
import config from "#private/lib/config";

const paramsSchema = z.strictObject({
    orgId: z.string()
});

const bodySchema = z.strictObject({
    logoUrl: z
        .string()
        .superRefine(async (urlOrPath, ctx) => {
            // Allow empty string (no logo)
            if (urlOrPath.length === 0) {
                return;
            }

            const parseResult = z.url().safeParse(urlOrPath);
            if (!parseResult.success) {
                if (build !== "enterprise") {
                    ctx.addIssue({
                        code: "custom",
                        message: "Must be a valid URL"
                    });
                    return;
                } else {
                    try {
                        validateLocalPath(urlOrPath);
                    } catch (error) {
                        ctx.addIssue({
                            code: "custom",
                            message:
                                "Must be either a valid image URL or a valid pathname starting with `/` and not containing query parameters, `..` or `*`"
                        });
                    } finally {
                        return;
                    }
                }
            }

            try {
                const response = await fetch(urlOrPath, {
                    method: "HEAD"
                }).catch(() => {
                    // If HEAD fails (CORS or method not allowed), try GET
                    return fetch(urlOrPath, { method: "GET" });
                });

                if (response.status !== 200) {
                    ctx.addIssue({
                        code: "custom",
                        message: `Failed to load image. Please check that the URL is accessible.`
                    });
                    return;
                }

                const contentType = response.headers.get("content-type") ?? "";
                if (!contentType.startsWith("image/")) {
                    ctx.addIssue({
                        code: "custom",
                        message: `URL does not point to an image. Please provide a URL to an image file (e.g., .png, .jpg, .svg).`
                    });
                    return;
                }
            } catch (error) {
                let errorMessage =
                    "Unable to verify image URL. Please check that the URL is accessible and points to an image file.";

                if (
                    error instanceof TypeError &&
                    error.message.includes("fetch")
                ) {
                    errorMessage =
                        "Network error: Unable to reach the URL. Please check your internet connection and verify the URL is correct.";
                } else if (error instanceof Error) {
                    errorMessage = `Error verifying URL: ${error.message}`;
                }

                ctx.addIssue({
                    code: "custom",
                    message: errorMessage
                });
            }
        })
        .transform((val) => (val === "" ? null : val))
        .nullish(),
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
        const parsedBody = await bodySchema.safeParseAsync(req.body);
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

        let updateData = parsedBody.data satisfies InferInsertModel<
            typeof loginPageBranding
        >;

        // Empty strings are transformed to null by the schema, which will clear the logo URL in the database
        // We keep it as null (not undefined) because undefined fields are omitted from Drizzle updates

        if (
            build !== "saas" &&
            !config.getRawPrivateConfig().flags.use_org_only_idp
        ) {
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
