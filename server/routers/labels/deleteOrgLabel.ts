import { db, labels } from "@server/db";
import response from "@server/lib/response";
import logger from "@server/logger";
import { OpenAPITags, registry } from "@server/openApi";
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

registry.registerPath({
    method: "delete",
    path: "/org/{orgId}/label/{labelId}",
    description: "Delete a label.",
    tags: [OpenAPITags.Label],
    request: {
        params: paramsSchema
    },
    responses: {
        200: {
            description: "Successful response",
            content: {
                "application/json": {
                    schema: z.object({
                        data: z.record(z.string(), z.any()).nullable(),
                        success: z.boolean(),
                        error: z.boolean(),
                        message: z.string(),
                        status: z.number()
                    })
                }
            }
        }
    }
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
