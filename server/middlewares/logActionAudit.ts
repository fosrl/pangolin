import { ActionsEnum } from "@server/auth/actions";
import { Request, Response, NextFunction } from "express";

export function logActionAudit(action: ActionsEnum) {
    return async function (
        req: Request,
        res: Response,
        next: NextFunction
    ): Promise<any> {
        next();
    };
}

export async function cleanUpOldLogs(orgId: string, retentionDays: number) {
    return;
}
