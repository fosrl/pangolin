import { db, launcherViews } from "@server/db";
import { response } from "@server/lib/response";
import HttpCode from "@server/types/HttpCode";
import { NextFunction, Request, Response } from "express";
import createHttpError from "http-errors";
import moment from "moment";
import { fromZodError } from "zod-validation-error";
import { z } from "zod";
import { ActionsEnum, checkUserActionPermission } from "@server/auth/actions";
import { launcherViewConfigSchema } from "./types";

const createLauncherViewBodySchema = z.strictObject({
    name: z.string().min(1).max(128),
    config: launcherViewConfigSchema,
    orgWide: z.boolean().optional().default(false)
});

export async function createLauncherView(
    req: Request,
    res: Response,
    next: NextFunction
): Promise<any> {
    try {
        const orgId = req.userOrgId;
        const userId = req.user!.userId;

        if (!orgId) {
            return next(
                createHttpError(HttpCode.BAD_REQUEST, "Invalid organization ID")
            );
        }

        const parsed = createLauncherViewBodySchema.safeParse(req.body);
        if (!parsed.success) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    fromZodError(parsed.error)
                )
            );
        }

        if (parsed.data.orgWide) {
            const canCreateOrgWide = await checkUserActionPermission(
                ActionsEnum.createOrgWideLauncherView,
                req
            );
            if (!canCreateOrgWide) {
                return next(
                    createHttpError(
                        HttpCode.FORBIDDEN,
                        "User does not have permission perform this action"
                    )
                );
            }
        }

        const now = moment().toISOString();
        const [created] = await db
            .insert(launcherViews)
            .values({
                orgId,
                userId: parsed.data.orgWide ? null : userId,
                name: parsed.data.name,
                config: JSON.stringify(parsed.data.config),
                createdAt: now,
                updatedAt: now
            })
            .returning();

        return response(res, {
            data: {
                viewId: created.viewId,
                orgId: created.orgId,
                userId: created.userId,
                name: created.name,
                config: launcherViewConfigSchema.parse(
                    JSON.parse(created.config)
                ),
                createdAt: created.createdAt,
                updatedAt: created.updatedAt,
                isOrgWide: created.userId == null,
                isDefault: created.isDefault
            },
            success: true,
            error: false,
            message: "Launcher view created successfully",
            status: HttpCode.CREATED
        });
    } catch (error) {
        if (createHttpError.isHttpError(error)) {
            return next(error);
        }
        console.error("Error creating launcher view:", error);
        return next(
            createHttpError(
                HttpCode.INTERNAL_SERVER_ERROR,
                "Internal server error"
            )
        );
    }
}
