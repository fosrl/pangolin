import {
    db,
    labels,
    resourceLabels,
    resources,
    siteLabels,
    sites
} from "@server/db";
import response from "@server/lib/response";
import logger from "@server/logger";
import type { CreateOrEditLabelResponse } from "@server/routers/labels/types";
import HttpCode from "@server/types/HttpCode";
import { and, eq, sql } from "drizzle-orm";
import { NextFunction, Request, Response } from "express";
import createHttpError from "http-errors";
import { z } from "zod";
import { fromError } from "zod-validation-error";

const paramsSchema = z.strictObject({
    orgId: z.string().nonempty()
});

const bodySchema = z.strictObject({
    name: z.string().nonempty(),
    color: z
        .string()
        .regex(/^#?([0-9a-f]{6}|[0-9a-f]{3})$/i)
        .nonempty(),
    siteId: z.number().int().optional(),
    resourceId: z.number().int().optional()
});

export async function createOrgLabel(
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

        const { orgId } = parsedParams.data;

        const parsedBody = bodySchema.safeParse(req.body);
        if (!parsedBody.success) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    fromError(parsedBody.error).toString()
                )
            );
        }

        const { name, color, siteId, resourceId } = parsedBody.data;

        if (siteId) {
            const siteCount = await db.$count(
                sites,
                and(eq(sites.siteId, siteId), eq(sites.orgId, orgId))
            );

            if (siteCount === 0) {
                return next(
                    createHttpError(
                        HttpCode.BAD_REQUEST,
                        `Site with Id ${siteId} doesn't exist.`
                    )
                );
            }
        }

        if (resourceId) {
            const resourceCount = await db.$count(
                resources,
                and(
                    eq(resources.resourceId, resourceId),
                    eq(resources.orgId, orgId)
                )
            );

            if (resourceCount === 0) {
                return next(
                    createHttpError(
                        HttpCode.BAD_REQUEST,
                        `Resource with Id ${resourceId} doesn't exist.`
                    )
                );
            }
        }

        const [existingLabel] = await db
            .select({ labelId: labels.labelId })
            .from(labels)
            .where(
                and(
                    eq(labels.orgId, orgId),
                    sql`LOWER(${labels.name}) = ${name.toLowerCase()}`
                )
            )
            .limit(1);

        if (existingLabel) {
            return next(
                createHttpError(
                    HttpCode.CONFLICT,
                    "A label with this name already exists"
                )
            );
        }

        const label = await db.transaction(async (tx) => {
            const [label] = await tx
                .insert(labels)
                .values({
                    name,
                    color,
                    orgId
                })
                .returning();

            if (siteId) {
                await tx.insert(siteLabels).values({
                    siteId,
                    labelId: label.labelId
                });
            }

            if (resourceId) {
                await tx.insert(resourceLabels).values({
                    resourceId,
                    labelId: label.labelId
                });
            }
            return label;
        });

        return response<CreateOrEditLabelResponse>(res, {
            data: { label },
            success: true,
            error: false,
            message: "Org Label created successfully",
            status: HttpCode.CREATED
        });
    } catch (error) {
        logger.error(error);
        return next(
            createHttpError(HttpCode.INTERNAL_SERVER_ERROR, "An error occurred")
        );
    }
}
