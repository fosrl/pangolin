import { response } from "@server/lib/response";
import HttpCode from "@server/types/HttpCode";
import { NextFunction, Request, Response } from "express";
import createHttpError from "http-errors";
import { fromZodError } from "zod-validation-error";
import { getLauncherScaleForUser } from "./launcherScale";
import { launcherScaleQuerySchema } from "./types";

export async function listLauncherScale(
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

        const parsed = launcherScaleQuerySchema.safeParse(req.query);
        if (!parsed.success) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    fromZodError(parsed.error)
                )
            );
        }

        const scale = await getLauncherScaleForUser(
            orgId,
            userId,
            req.userOrgRoleIds ?? [],
            parsed.data
        );

        return response(res, {
            data: { scale },
            success: true,
            error: false,
            message: "Launcher scale retrieved successfully",
            status: HttpCode.OK
        });
    } catch (error) {
        if (createHttpError.isHttpError(error)) {
            return next(error);
        }
        console.error("Error listing launcher scale:", error);
        return next(
            createHttpError(
                HttpCode.INTERNAL_SERVER_ERROR,
                "Internal server error"
            )
        );
    }
}
