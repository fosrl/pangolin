import { response } from "@server/lib/response";
import HttpCode from "@server/types/HttpCode";
import { NextFunction, Request, Response } from "express";
import createHttpError from "http-errors";
import { fromZodError } from "zod-validation-error";
import { listLauncherGroupsForUser } from "./launcherResourceAccess";
import { launcherListQuerySchema } from "./types";

export async function listLauncherGroups(
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

        const parsed = launcherListQuerySchema.safeParse(req.query);
        if (!parsed.success) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    fromZodError(parsed.error)
                )
            );
        }

        const { groups, total } = await listLauncherGroupsForUser(
            orgId,
            userId,
            req.userOrgRoleIds ?? [],
            parsed.data
        );

        return response(res, {
            data: {
                groups,
                pagination: {
                    total,
                    page: parsed.data.page,
                    pageSize: parsed.data.pageSize
                }
            },
            success: true,
            error: false,
            message: "Launcher groups retrieved successfully",
            status: HttpCode.OK
        });
    } catch (error) {
        if (createHttpError.isHttpError(error)) {
            return next(error);
        }
        console.error("Error listing launcher groups:", error);
        return next(
            createHttpError(
                HttpCode.INTERNAL_SERVER_ERROR,
                "Internal server error"
            )
        );
    }
}
