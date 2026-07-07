import { regionalCache as cache } from "#dynamic/lib/cache";
import { response } from "@server/lib/response";
import HttpCode from "@server/types/HttpCode";
import { NextFunction, Request, Response } from "express";
import createHttpError from "http-errors";

async function invalidateLauncherCacheForUser(
    orgId: string,
    userId: string
): Promise<void> {
    const prefixes = [
        `launcherAccessibleIds:${orgId}:${userId}:`,
        `launcher:groups:${orgId}:${userId}:`,
        `launcher:results:${orgId}:${userId}:`,
        `launcher:scale:counts:${orgId}:${userId}:`
    ];

    const keys = (
        await Promise.all(
            prefixes.map((prefix) => cache.keysWithPrefix(prefix))
        )
    ).flat();

    if (keys.length > 0) {
        await cache.del(keys);
    }
}

export async function invalidateLauncherCache(
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

        await invalidateLauncherCacheForUser(orgId, userId);

        return response(res, {
            data: null,
            success: true,
            error: false,
            message: "Launcher cache invalidated successfully",
            status: HttpCode.OK
        });
    } catch (error) {
        if (createHttpError.isHttpError(error)) {
            return next(error);
        }
        console.error("Error invalidating launcher cache:", error);
        return next(
            createHttpError(
                HttpCode.INTERNAL_SERVER_ERROR,
                "Internal server error"
            )
        );
    }
}
