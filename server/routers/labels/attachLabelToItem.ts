import {
    clients,
    clientLabels,
    db,
    labels,
    resourceLabels,
    resources,
    siteLabels,
    siteResourceLabels,
    siteResources,
    sites
} from "@server/db";
import response from "@server/lib/response";
import logger from "@server/logger";
import HttpCode from "@server/types/HttpCode";
import { and, eq, isNull } from "drizzle-orm";
import { NextFunction, Request, Response } from "express";
import createHttpError from "http-errors";
import { z } from "zod";
import { fromError } from "zod-validation-error";

const paramsSchema = z.strictObject({
    orgId: z.string().nonempty(),
    labelId: z.string().transform(Number).pipe(z.int().positive())
});

const attachLabelBodySchema = z.strictObject({
    siteId: z.number().int().optional(),
    resourceId: z.number().int().optional(),
    siteResourceId: z.number().int().optional(),
    clientId: z.number().int().optional()
});

export async function attachLabelToItem(
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

        const parsedBody = attachLabelBodySchema.safeParse(req.body);
        if (!parsedBody.success) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    fromError(parsedBody.error).toString()
                )
            );
        }

        const { siteId, resourceId, siteResourceId, clientId } =
            parsedBody.data;

        if (!siteId && !resourceId && !siteResourceId && !clientId) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    "At least one of `siteId`, `resourceId`, `siteResourceId` or `clientId` should be provided."
                )
            );
        }

        const [existing] = await db
            .select()
            .from(labels)
            .where(and(eq(labels.labelId, labelId), eq(labels.orgId, orgId)));

        if (!existing) {
            return next(
                createHttpError(
                    HttpCode.NOT_FOUND,
                    `Label with Id ${labelId} not found`
                )
            );
        }

        if (siteId) {
            const siteCount = await db.$count(
                sites,
                and(eq(sites.siteId, siteId), eq(sites.orgId, orgId))
            );

            if (siteCount === 0) {
                return next(
                    createHttpError(
                        HttpCode.NOT_FOUND,
                        `Site with Id ${siteId} doesn't exist.`
                    )
                );
            }

            // idempotent, calling this endpoint multiple times should attach the label only once
            await db
                .insert(siteLabels)
                .values({
                    labelId,
                    siteId
                })
                .onConflictDoNothing();
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
                        HttpCode.NOT_FOUND,
                        `Resource with Id ${resourceId} doesn't exist.`
                    )
                );
            }

            // idempotent, calling this endpoint multiple times should attach the label only once
            await db
                .insert(resourceLabels)
                .values({
                    labelId,
                    resourceId
                })
                .onConflictDoNothing();
        }

        if (siteResourceId) {
            const resourceCount = await db.$count(
                siteResources,
                and(
                    eq(siteResources.siteResourceId, siteResourceId),
                    eq(siteResources.orgId, orgId)
                )
            );

            if (resourceCount === 0) {
                return next(
                    createHttpError(
                        HttpCode.NOT_FOUND,
                        `SiteResource with Id ${siteResourceId} doesn't exist.`
                    )
                );
            }

            // idempotent, calling this endpoint multiple times should attach the label only once
            await db
                .insert(siteResourceLabels)
                .values({
                    labelId,
                    siteResourceId
                })
                .onConflictDoNothing();
        }

        if (clientId) {
            const clientCount = await db.$count(
                clients,
                and(
                    eq(clients.clientId, clientId),
                    eq(clients.orgId, orgId),
                    isNull(clients.userId)
                )
            );

            if (clientCount === 0) {
                return next(
                    createHttpError(
                        HttpCode.NOT_FOUND,
                        `Client with Id ${clientId} doesn't exist.`
                    )
                );
            }

            // idempotent, calling this endpoint multiple times should attach the label only once
            await db
                .insert(clientLabels)
                .values({
                    labelId,
                    clientId
                })
                .onConflictDoNothing();
        }

        return response(res, {
            data: {},
            success: true,
            error: false,
            message: "Label attached successfully",
            status: HttpCode.OK
        });
    } catch (error) {
        logger.error(error);
        return next(
            createHttpError(HttpCode.INTERNAL_SERVER_ERROR, "An error occurred")
        );
    }
}
