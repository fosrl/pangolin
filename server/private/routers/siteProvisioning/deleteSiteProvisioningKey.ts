/*
 * This file is part of a proprietary work.
 *
 * Copyright (c) 2025-2026 Fossorial, Inc.
 * All rights reserved.
 *
 * This file is licensed under the Fossorial Commercial License.
 * You may not use this file except in compliance with the License.
 * Unauthorized use, copying, modification, or distribution is strictly prohibited.
 *
 * This file is not licensed under the AGPLv3.
 */

import { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { db, siteProvisioningKeyOrg, siteProvisioningKeys } from "@server/db";
import { and, eq } from "drizzle-orm";
import response from "@server/lib/response";
import HttpCode from "@server/types/HttpCode";
import createHttpError from "http-errors";
import logger from "@server/logger";
import { fromError } from "zod-validation-error";
import { OpenAPITags, registry } from "@server/openApi";

const paramsSchema = z.object({
    siteProvisioningKeyId: z.string().nonempty(),
    orgId: z.string().nonempty()
});

registry.registerPath({
    method: "delete",
    path: "/org/{orgId}/site-provisioning-key/{siteProvisioningKeyId}",
    description: "Delete a site provisioning key.",
    tags: [OpenAPITags.SiteProvisioningKey],
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

export async function deleteSiteProvisioningKey(
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

        const { siteProvisioningKeyId, orgId } = parsedParams.data;

        const [row] = await db
            .select()
            .from(siteProvisioningKeys)
            .where(
                eq(
                    siteProvisioningKeys.siteProvisioningKeyId,
                    siteProvisioningKeyId
                )
            )
            .innerJoin(
                siteProvisioningKeyOrg,
                and(
                    eq(
                        siteProvisioningKeys.siteProvisioningKeyId,
                        siteProvisioningKeyOrg.siteProvisioningKeyId
                    ),
                    eq(siteProvisioningKeyOrg.orgId, orgId)
                )
            )
            .limit(1);

        if (!row) {
            return next(
                createHttpError(
                    HttpCode.NOT_FOUND,
                    `Site provisioning key with ID ${siteProvisioningKeyId} not found`
                )
            );
        }

        await db.transaction(async (trx) => {
            await trx
                .delete(siteProvisioningKeyOrg)
                .where(
                    and(
                        eq(
                            siteProvisioningKeyOrg.siteProvisioningKeyId,
                            siteProvisioningKeyId
                        ),
                        eq(siteProvisioningKeyOrg.orgId, orgId)
                    )
                );

            const siteProvisioningKeyOrgs = await trx
                .select()
                .from(siteProvisioningKeyOrg)
                .where(
                    eq(
                        siteProvisioningKeyOrg.siteProvisioningKeyId,
                        siteProvisioningKeyId
                    )
                );

            if (siteProvisioningKeyOrgs.length === 0) {
                await trx
                    .delete(siteProvisioningKeys)
                    .where(
                        eq(
                            siteProvisioningKeys.siteProvisioningKeyId,
                            siteProvisioningKeyId
                        )
                    );
            }
        });

        return response(res, {
            data: null,
            success: true,
            error: false,
            message: "Site provisioning key deleted successfully",
            status: HttpCode.OK
        });
    } catch (error) {
        logger.error(error);
        return next(
            createHttpError(HttpCode.INTERNAL_SERVER_ERROR, "An error occurred")
        );
    }
}
