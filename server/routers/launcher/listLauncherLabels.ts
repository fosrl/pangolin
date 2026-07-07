import { response } from "@server/lib/response";
import HttpCode from "@server/types/HttpCode";
import { NextFunction, Request, Response } from "express";
import createHttpError from "http-errors";
import { fromZodError } from "zod-validation-error";
import { listAccessibleLauncherLabelsForUser } from "./launcherResourceAccess";
import { launcherFilterListQuerySchema } from "./types";

export async function listLauncherLabels(
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

        const parsed = launcherFilterListQuerySchema.safeParse(req.query);
        if (!parsed.success) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    fromZodError(parsed.error)
                )
            );
        }

        const { labels, total } = await listAccessibleLauncherLabelsForUser(
            orgId,
            userId,
            req.userOrgRoleIds ?? [],
            parsed.data
        );

        return response(res, {
            data: {
                labels,
                pagination: {
                    total,
                    page: parsed.data.page,
                    pageSize: parsed.data.pageSize
                }
            },
            success: true,
            error: false,
            message: "Launcher labels retrieved successfully",
            status: HttpCode.OK
        });
    } catch (error) {
        if (createHttpError.isHttpError(error)) {
            return next(error);
        }
        console.error("Error listing launcher labels:", error);
        return next(
            createHttpError(
                HttpCode.INTERNAL_SERVER_ERROR,
                "Internal server error"
            )
        );
    }
}
