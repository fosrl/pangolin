import { db, labels } from "@server/db";
import response from "@server/lib/response";
import logger from "@server/logger";
import HttpCode from "@server/types/HttpCode";
import { and, eq } from "drizzle-orm";
import { NextFunction, Request, Response } from "express";
import createHttpError from "http-errors";
import { z } from "zod";
import { fromError } from "zod-validation-error";

const paramsSchema = z.strictObject({
    orgId: z.string().nonempty(),
    labelId: z.string().transform(Number).pipe(z.int().positive())
});

export async function deleteOrgLabel(
    req: Request,
    res: Response,
    next: NextFunction
) {
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

        const { orgId, labelId } = parsedParams.data;

        const [existing] = await db
            .select()
            .from(labels)
            .where(and(eq(labels.labelId, labelId), eq(labels.orgId, orgId)));

        if (!existing) {
            return next(createHttpError(HttpCode.NOT_FOUND, "Label not found"));
        }

        await db
            .delete(labels)
            .where(and(eq(labels.labelId, labelId), eq(labels.orgId, orgId)));

        return response(res, {
            data: null,
            success: true,
            error: false,
            message: "Label deleted successfully",
            status: HttpCode.OK
        });
    } catch (error) {
        logger.error(error);
        return next(
            createHttpError(HttpCode.INTERNAL_SERVER_ERROR, "An error occurred")
        );
    }
}
