import { response } from "@server/lib/response";
import HttpCode from "@server/types/HttpCode";
import { NextFunction, Request, Response } from "express";
import createHttpError from "http-errors";
import { fromZodError } from "zod-validation-error";
import { z } from "zod";
import { ActionsEnum, checkUserActionPermission } from "@server/auth/actions";
import {
    deleteAllDefaultViewOverrides,
    deleteDefaultViewOverride
} from "./launcherDefaultView";

const deleteLauncherDefaultViewBodySchema = z.strictObject({
    orgWide: z.boolean().optional().default(false),
    all: z.boolean().optional().default(false)
});

export async function deleteLauncherDefaultView(
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

        const parsed = deleteLauncherDefaultViewBodySchema.safeParse(req.body);
        if (!parsed.success) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    fromZodError(parsed.error)
                )
            );
        }

        if (parsed.data.all) {
            const canManageOrgWide = await checkUserActionPermission(
                ActionsEnum.createOrgWideLauncherView,
                req
            );
            if (!canManageOrgWide) {
                return next(
                    createHttpError(
                        HttpCode.FORBIDDEN,
                        "User does not have permission perform this action"
                    )
                );
            }

            await deleteAllDefaultViewOverrides(orgId, userId);
        } else if (parsed.data.orgWide) {
            const canManageOrgWide = await checkUserActionPermission(
                ActionsEnum.createOrgWideLauncherView,
                req
            );
            if (!canManageOrgWide) {
                return next(
                    createHttpError(
                        HttpCode.FORBIDDEN,
                        "User does not have permission perform this action"
                    )
                );
            }

            await deleteDefaultViewOverride({
                orgId,
                userId,
                orgWide: true
            });
        } else {
            await deleteDefaultViewOverride({
                orgId,
                userId,
                orgWide: false
            });
        }

        return response(res, {
            data: null,
            success: true,
            error: false,
            message: "Launcher default view reset successfully",
            status: HttpCode.OK
        });
    } catch (error) {
        if (createHttpError.isHttpError(error)) {
            return next(error);
        }
        console.error("Error resetting launcher default view:", error);
        return next(
            createHttpError(
                HttpCode.INTERNAL_SERVER_ERROR,
                "Internal server error"
            )
        );
    }
}
