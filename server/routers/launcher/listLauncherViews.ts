import { db, launcherViews } from "@server/db";
import { response } from "@server/lib/response";
import HttpCode from "@server/types/HttpCode";
import { and, eq, isNull, or } from "drizzle-orm";
import { NextFunction, Request, Response } from "express";
import createHttpError from "http-errors";
import {
    extractDefaultViewOverrides,
    listVisibleLauncherViews
} from "./launcherDefaultView";

export async function listLauncherViews(
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

        const rows = await db
            .select()
            .from(launcherViews)
            .where(
                and(
                    eq(launcherViews.orgId, orgId),
                    or(
                        eq(launcherViews.userId, userId),
                        isNull(launcherViews.userId)
                    )
                )
            );

        return response(res, {
            data: {
                views: listVisibleLauncherViews(rows),
                defaultViewOverrides: extractDefaultViewOverrides(rows)
            },
            success: true,
            error: false,
            message: "Launcher views retrieved successfully",
            status: HttpCode.OK
        });
    } catch (error) {
        if (createHttpError.isHttpError(error)) {
            return next(error);
        }
        console.error("Error listing launcher views:", error);
        return next(
            createHttpError(
                HttpCode.INTERNAL_SERVER_ERROR,
                "Internal server error"
            )
        );
    }
}
