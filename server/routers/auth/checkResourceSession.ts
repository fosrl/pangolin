import { Request, Response, NextFunction } from "express";
import createHttpError from "http-errors";
import { z } from "zod";
import { fromError } from "zod-validation-error";
import HttpCode from "@server/types/HttpCode";
import { response } from "@server/lib/response";
import { validateResourceSessionToken } from "@server/auth/sessions/resource";
import logger from "@server/logger";

export const params = z.strictObject({
    token: z.string(),
    resourceId: z.coerce.number().int().positive()
});

export type CheckResourceSessionParams = z.infer<typeof params>;

export type CheckResourceSessionResponse = {
    valid: boolean;
};

export async function checkResourceSession(
    req: Request,
    res: Response,
    next: NextFunction
): Promise<any> {
    const parsedParams = params.safeParse(req.params);

    if (!parsedParams.success) {
        return next(
            createHttpError(
                HttpCode.BAD_REQUEST,
                fromError(parsedParams.error).toString()
            )
        );
    }

    const { token, resourceId } = parsedParams.data;

    try {
        const { resourceSession } = await validateResourceSessionToken(
            token,
            resourceId
        );

        let valid = false;
        if (resourceSession) {
            valid = true;
        }

        return response<CheckResourceSessionResponse>(res, {
            data: { valid },
            success: true,
            error: false,
            message: "Checked validity",
            status: HttpCode.OK
        });
    } catch (e) {
        logger.error(e);
        return next(
            createHttpError(
                HttpCode.INTERNAL_SERVER_ERROR,
                "Failed to reset password"
            )
        );
    }
}
