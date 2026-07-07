import { Request, Response, NextFunction } from "express";
import createHttpError from "http-errors";
import HttpCode from "@server/types/HttpCode";
import logger from "@server/logger";
import { ActionsEnum, checkUserActionPermission } from "@server/auth/actions";

/**
 * Allows the new setUserOrgRoles action, or legacy permission pair addUserRole + removeUserRole.
 */
export function verifyUserCanSetUserOrgRoles() {
    return async function (
        req: Request,
        res: Response,
        next: NextFunction
    ): Promise<any> {
        try {
            const canSet = await checkUserActionPermission(
                ActionsEnum.setUserOrgRoles,
                req
            );
            if (canSet) {
                return next();
            }

            const canAdd = await checkUserActionPermission(
                ActionsEnum.addUserRole,
                req
            );
            const canRemove = await checkUserActionPermission(
                ActionsEnum.removeUserRole,
                req
            );

            if (canAdd && canRemove) {
                return next();
            }

            return next(
                createHttpError(
                    HttpCode.FORBIDDEN,
                    "User does not have permission to set user organization roles"
                )
            );
        } catch (error) {
            logger.error("Error verifying set user org roles access:", error);
            return next(
                createHttpError(
                    HttpCode.INTERNAL_SERVER_ERROR,
                    "Error verifying role access"
                )
            );
        }
    };
}
