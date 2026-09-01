import { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { aiBudgets, db } from "@server/db";
import response from "@server/lib/response";
import HttpCode from "@server/types/HttpCode";
import createHttpError from "http-errors";
import logger from "@server/logger";
import { fromError } from "zod-validation-error";
import { OpenAPITags, registry } from "@server/openApi";
import { eq } from "drizzle-orm";

const paramsSchema = z.strictObject({
    budgetId: z.coerce.number().int().positive()
});

registry.registerPath({
    method: "delete",
    path: "/ai-budget/{budgetId}",
    description: "Delete an AI budget.",
    tags: [OpenAPITags.AiBudget],
    request: {
        params: paramsSchema
    },
    responses: {
        200: {
            description: "Successful response"
        }
    }
});

export async function deleteAiBudget(
    req: Request,
    res: Response,
    next: NextFunction
): Promise<any> {
    try {
        const parsedParams = paramsSchema.safeParse(req.params);
        if (!parsedParams.success) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    fromError(parsedParams.error).toString()
                )
            );
        }

        const { budgetId } = parsedParams.data;

        const [existing] = await db
            .select({ budgetId: aiBudgets.budgetId })
            .from(aiBudgets)
            .where(eq(aiBudgets.budgetId, budgetId))
            .limit(1);

        if (!existing) {
            return next(
                createHttpError(
                    HttpCode.NOT_FOUND,
                    `AI budget with ID ${budgetId} not found`
                )
            );
        }

        await db.delete(aiBudgets).where(eq(aiBudgets.budgetId, budgetId));

        return response(res, {
            data: null,
            success: true,
            error: false,
            message: "AI budget deleted successfully",
            status: HttpCode.OK
        });
    } catch (error) {
        logger.error(error);
        return next(
            createHttpError(HttpCode.INTERNAL_SERVER_ERROR, "An error occurred")
        );
    }
}
