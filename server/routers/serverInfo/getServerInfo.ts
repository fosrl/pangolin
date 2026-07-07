import { Request, Response, NextFunction } from "express";
import HttpCode from "@server/types/HttpCode";
import createHttpError from "http-errors";
import logger from "@server/logger";
import { response as sendResponse } from "@server/lib/response";
import { build } from "@server/build";
import { APP_VERSION } from "@server/lib/consts";
import license from "#dynamic/license/license";

export type GetServerInfoResponse = {
    version: string;
    supporterStatusValid: boolean;
    build: "oss" | "enterprise" | "saas";
    enterpriseLicenseValid: boolean;
    enterpriseLicenseType: string | null;
};

export async function getServerInfo(
    req: Request,
    res: Response,
    next: NextFunction
): Promise<any> {
    try {
        let enterpriseLicenseValid = false;
        let enterpriseLicenseType: string | null = null;

        if (build === "enterprise") {
            try {
                const licenseStatus = await license.check();
                enterpriseLicenseValid = licenseStatus.isLicenseValid;
                enterpriseLicenseType = licenseStatus.tier || null;
            } catch (error) {
                logger.warn("Failed to check enterprise license status:", error);
            }
        }

        return sendResponse<GetServerInfoResponse>(res, {
            data: {
                version: APP_VERSION,
                supporterStatusValid: true,
                build,
                enterpriseLicenseValid,
                enterpriseLicenseType
            },
            success: true,
            error: false,
            message: "Server info retrieved",
            status: HttpCode.OK
        });
    } catch (error) {
        logger.error(error);
        return next(
            createHttpError(HttpCode.INTERNAL_SERVER_ERROR, "An error occurred")
        );
    }
}
