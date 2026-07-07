import { Request, Response, NextFunction } from "express";
import createHttpError from "http-errors";
import HttpCode from "@server/types/HttpCode";
import { usageService } from "@server/lib/billing/usageService";
import { build } from "@server/build";
import { getFirstString } from "@server/lib/requestParams";

export async function verifyLimits(
    req: Request,
    res: Response,
    next: NextFunction
) {
    if (build != "saas") {
        return next();
    }

    const orgId =
        req.userOrgId ||
        req.apiKeyOrg?.orgId ||
        getFirstString(req.params.orgId);

    if (!orgId) {
        return next(); // its fine if we silently fail here because this is not critical to operation or security and its better user experience if we dont fail
    }

    try {
        const reject = await usageService.checkLimitSet(orgId);

        if (reject) {
            return next(
                createHttpError(
                    HttpCode.PAYMENT_REQUIRED,
                    "Organization has exceeded its usage limits. Please upgrade your plan or contact support."
                )
            );
        }

        return next();
    } catch (e) {
        return next(
            createHttpError(
                HttpCode.INTERNAL_SERVER_ERROR,
                "Error checking limits"
            )
        );
    }
}
