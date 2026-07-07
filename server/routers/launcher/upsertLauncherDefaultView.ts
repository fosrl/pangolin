import { response } from "@server/lib/response";
import HttpCode from "@server/types/HttpCode";
import { NextFunction, Request, Response } from "express";
import createHttpError from "http-errors";
import { fromZodError } from "zod-validation-error";
import { z } from "zod";
import { ActionsEnum, checkUserActionPermission } from "@server/auth/actions";
import { upsertDefaultViewOverride } from "./launcherDefaultView";
import { launcherViewConfigSchema } from "./types";

const upsertLauncherDefaultViewBodySchema = z.strictObject({
    config: launcherViewConfigSchema,
    orgWide: z.boolean().optional().default(false)
});

export async function upsertLauncherDefaultView(
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

        const parsed = upsertLauncherDefaultViewBodySchema.safeParse(req.body);
        if (!parsed.success) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    fromZodError(parsed.error)
                )
            );
        }

        if (parsed.data.orgWide) {
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
        }

        const view = await upsertDefaultViewOverride({
            orgId,
            userId,
            orgWide: parsed.data.orgWide,
            config: parsed.data.config
        });

        return response(res, {
            data: view,
            success: true,
            error: false,
            message: "Launcher default view saved successfully",
            status: HttpCode.OK
        });
    } catch (error) {
        if (createHttpError.isHttpError(error)) {
            return next(error);
        }
        console.error("Error saving launcher default view:", error);
        return next(
            createHttpError(
                HttpCode.INTERNAL_SERVER_ERROR,
                "Internal server error"
            )
        );
    }
}
