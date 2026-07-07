import { db, launcherViews } from "@server/db";
import { response } from "@server/lib/response";
import { getFirstString } from "@server/lib/requestParams";
import HttpCode from "@server/types/HttpCode";
import { and, eq } from "drizzle-orm";
import { NextFunction, Request, Response } from "express";
import createHttpError from "http-errors";
import moment from "moment";
import { fromZodError } from "zod-validation-error";
import { z } from "zod";
import { ActionsEnum, checkUserActionPermission } from "@server/auth/actions";
import { launcherViewConfigSchema } from "./types";

const updateLauncherViewBodySchema = z.strictObject({
    name: z.string().min(1).max(128).optional(),
    config: launcherViewConfigSchema.optional(),
    orgWide: z.boolean().optional()
});

export async function updateLauncherView(
    req: Request,
    res: Response,
    next: NextFunction
): Promise<any> {
    try {
        const orgId = req.userOrgId;
        const userId = req.user!.userId;
        const viewId = Number.parseInt(
            getFirstString(req.params.viewId) ?? "",
            10
        );

        if (!orgId || !Number.isFinite(viewId)) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    "Invalid request parameters"
                )
            );
        }

        const parsed = updateLauncherViewBodySchema.safeParse(req.body);
        if (!parsed.success) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    fromZodError(parsed.error)
                )
            );
        }

        const [existing] = await db
            .select()
            .from(launcherViews)
            .where(
                and(
                    eq(launcherViews.viewId, viewId),
                    eq(launcherViews.orgId, orgId)
                )
            )
            .limit(1);

        if (!existing) {
            return next(
                createHttpError(HttpCode.NOT_FOUND, "Launcher view not found")
            );
        }

        if (existing.isDefault) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    "Use the default view save endpoint for this view"
                )
            );
        }

        const isPersonalView = existing.userId === userId;
        const isOrgWideView = existing.userId == null;
        const canManageOrgWide = await checkUserActionPermission(
            ActionsEnum.createOrgWideLauncherView,
            req
        );

        if (!isPersonalView && !(isOrgWideView && canManageOrgWide)) {
            return next(
                createHttpError(
                    HttpCode.FORBIDDEN,
                    "You do not have permission to update this view"
                )
            );
        }

        if (parsed.data.orgWide === true && !canManageOrgWide) {
            return next(
                createHttpError(
                    HttpCode.FORBIDDEN,
                    "User does not have permission perform this action"
                )
            );
        }

        if (
            parsed.data.orgWide === false &&
            isOrgWideView &&
            !canManageOrgWide
        ) {
            return next(
                createHttpError(
                    HttpCode.FORBIDDEN,
                    "User does not have permission perform this action"
                )
            );
        }

        const nextUserId =
            parsed.data.orgWide === true
                ? null
                : parsed.data.orgWide === false
                  ? userId
                  : existing.userId;

        const [updated] = await db
            .update(launcherViews)
            .set({
                name: parsed.data.name ?? existing.name,
                config: parsed.data.config
                    ? JSON.stringify(parsed.data.config)
                    : existing.config,
                userId: nextUserId,
                updatedAt: moment().toISOString()
            })
            .where(eq(launcherViews.viewId, viewId))
            .returning();

        return response(res, {
            data: {
                viewId: updated.viewId,
                orgId: updated.orgId,
                userId: updated.userId,
                name: updated.name,
                config: launcherViewConfigSchema.parse(
                    JSON.parse(updated.config)
                ),
                createdAt: updated.createdAt,
                updatedAt: updated.updatedAt,
                isOrgWide: updated.userId == null,
                isDefault: updated.isDefault
            },
            success: true,
            error: false,
            message: "Launcher view updated successfully",
            status: HttpCode.OK
        });
    } catch (error) {
        if (createHttpError.isHttpError(error)) {
            return next(error);
        }
        console.error("Error updating launcher view:", error);
        return next(
            createHttpError(
                HttpCode.INTERNAL_SERVER_ERROR,
                "Internal server error"
            )
        );
    }
}
