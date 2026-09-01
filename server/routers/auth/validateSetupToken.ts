import { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { db, setupTokens } from "@server/db";
import { eq, and } from "drizzle-orm";
import response from "@server/lib/response";
import HttpCode from "@server/types/HttpCode";
import createHttpError from "http-errors";
import logger from "@server/logger";
import { fromError } from "zod-validation-error";

const validateSetupTokenSchema = z.strictObject({
    token: z.string().min(1, "Token is required")
});

export type ValidateSetupTokenResponse = {
    valid: boolean;
    message: string;
};

export async function validateSetupToken(
    req: Request,
    res: Response,
    next: NextFunction
): Promise<any> {
    try {
        const parsedBody = validateSetupTokenSchema.safeParse(req.body);

        if (!parsedBody.success) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    fromError(parsedBody.error).toString()
                )
            );
        }

        const { token } = parsedBody.data;

        // Find the token in the database
        const [setupToken] = await db
            .select()
            .from(setupTokens)
            .where(
                and(eq(setupTokens.token, token), eq(setupTokens.used, false))
            );

        if (!setupToken) {
            return response<ValidateSetupTokenResponse>(res, {
                data: {
                    valid: false,
                    message: "Invalid setup token"
                },
                success: true,
                error: false,
                message: "Token validation completed",
                status: HttpCode.OK
            });
        }

        return response<ValidateSetupTokenResponse>(res, {
            data: {
                valid: true,
                message: "Setup token is valid"
            },
            success: true,
            error: false,
            message: "Token validation completed",
            status: HttpCode.OK
        });
    } catch (error) {
        logger.error(error);
        return next(
            createHttpError(
                HttpCode.INTERNAL_SERVER_ERROR,
                "Failed to validate setup token"
            )
        );
    }
}
