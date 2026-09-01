import { db, labels } from "@server/db";
import response from "@server/lib/response";
import logger from "@server/logger";
import type { CreateOrEditLabelResponse } from "@server/routers/labels/types";
import HttpCode from "@server/types/HttpCode";
import { and, eq, ne, sql } from "drizzle-orm";
import { NextFunction, Request, Response } from "express";
import createHttpError from "http-errors";
import { z } from "zod";
import { fromError } from "zod-validation-error";

const paramsSchema = z.strictObject({
    orgId: z.string().nonempty(),
    labelId: z.string().transform(Number).pipe(z.int().positive())
});

const updateLabelBodySchema = z.strictObject({
    name: z.string().min(1).max(255).optional(),
    color: z
        .string()
        .regex(/^#?([0-9a-f]{6}|[0-9a-f]{3})$/i)
        .nonempty()
});

export async function updateOrgLabel(
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

        const parsedBody = updateLabelBodySchema.safeParse(req.body);
        if (!parsedBody.success) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    fromError(parsedBody.error).toString()
                )
            );
        }

        const [existing] = await db
            .select()
            .from(labels)
            .where(and(eq(labels.labelId, labelId), eq(labels.orgId, orgId)));

        if (!existing) {
            return next(createHttpError(HttpCode.NOT_FOUND, "Label not found"));
        }

        const { name, color } = parsedBody.data;

        if (name && name.toLowerCase() !== existing.name.toLowerCase()) {
            const [duplicateLabel] = await db
                .select({ labelId: labels.labelId })
                .from(labels)
                .where(
                    and(
                        eq(labels.orgId, orgId),
                        ne(labels.labelId, labelId),
                        sql`LOWER(${labels.name}) = ${name.toLowerCase()}`
                    )
                )
                .limit(1);

            if (duplicateLabel) {
                return next(
                    createHttpError(
                        HttpCode.CONFLICT,
                        "A label with this name already exists"
                    )
                );
            }
        }

        const [label] = await db
            .update(labels)
            .set({
                name,
                color
            })
            .where(and(eq(labels.labelId, labelId), eq(labels.orgId, orgId)))
            .returning();

        return response<CreateOrEditLabelResponse>(res, {
            data: {
                label
            },
            success: true,
            error: false,
            message: "Label updated successfully",
            status: HttpCode.OK
        });
    } catch (error) {
        logger.error(error);
        return next(
            createHttpError(HttpCode.INTERNAL_SERVER_ERROR, "An error occurred")
        );
    }
}
