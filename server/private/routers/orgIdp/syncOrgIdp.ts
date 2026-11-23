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
import { db, idp, idpOrg } from "@server/db";
import response from "@server/lib/response";
import HttpCode from "@server/types/HttpCode";
import createHttpError from "http-errors";
import logger from "@server/logger";
import { fromError } from "zod-validation-error";
import { and, eq } from "drizzle-orm";
import { OpenAPITags, registry } from "@server/openApi";
import { runIdpDirectorySync } from "#private/lib/idpAPI/syncWorkflow";
import { idpSyncDraftSchema, policyDraft } from "#private/lib/idpAPI/draft";
import { loadApiIdp } from "#private/lib/idpAPI/loadApiProvider";
import {
    countSyncEntries,
    previewChanges,
    summarizeEntries,
    type SyncCounts,
    type SyncEntrySummary
} from "#private/lib/idpAPI/syncSummary";

const paramsSchema = z
    .object({
        orgId: z.string().nonempty(),
        idpId: z.coerce.number<number>().int().positive()
    })
    .strict();

const bodySchema = z.strictObject({
    dryRun: z.boolean().optional().default(false),
    /** Dry run only: preview these unsaved form values instead of the saved settings. */
    draft: idpSyncDraftSchema.optional()
});

export type SyncOrgIdpResponse = {
    dryRun: boolean;
    counts: SyncCounts;
    /** Only for a dry run: the membership changes, at most `MAX_PREVIEW_ENTRIES`. */
    entries?: SyncEntrySummary[];
    /** Only for a dry run: some changes aren't in `entries` (the counts still include them). */
    entriesTruncated?: boolean;
};

registry.registerPath({
    method: "post",
    path: "/org/{orgId}/idp/{idpId}/sync",
    description:
        "Run the directory sync of an IdP for an organization now. With `dryRun`, returns what would change without writing anything.",
    tags: [OpenAPITags.OrgIdp],
    request: {
        params: paramsSchema,
        body: {
            content: {
                "application/json": {
                    schema: bodySchema
                }
            }
        }
    },
    responses: {}
});

export async function syncOrgIdp(
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

        const parsedBody = bodySchema.safeParse(req.body ?? {});
        if (!parsedBody.success) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    fromError(parsedBody.error).toString()
                )
            );
        }

        const { orgId, idpId } = parsedParams.data;
        const { dryRun, draft } = parsedBody.data;

        if (draft && !dryRun) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    "Unsaved settings can only be previewed (dryRun)"
                )
            );
        }

        const [existing] = await db
            .select({
                apiIntegrationEnabled: idp.apiIntegrationEnabled,
                directorySyncEnabled: idp.directorySyncEnabled
            })
            .from(idp)
            .innerJoin(idpOrg, eq(idpOrg.idpId, idp.idpId))
            .where(and(eq(idp.idpId, idpId), eq(idpOrg.orgId, orgId)))
            .limit(1);

        if (!existing) {
            return next(
                createHttpError(
                    HttpCode.NOT_FOUND,
                    `IdP with ID ${idpId} is not associated with organization ${orgId}`
                )
            );
        }

        // a draft may turn the integration on, `loadApiIdp` checks it instead
        if (!draft && !existing.apiIntegrationEnabled) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    "The API integration is not enabled for this IdP"
                )
            );
        }

        if (!dryRun && !existing.directorySyncEnabled) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    "Directory sync is not enabled for this IdP"
                )
            );
        }

        let draftIdp;
        if (draft) {
            draftIdp = await loadApiIdp(idpId, draft);
            if (draftIdp instanceof Error) {
                return next(draftIdp);
            }
        }

        const [result] = await runIdpDirectorySync({
            dryRun,
            idpId,
            orgId,
            draft:
                draft && draftIdp
                    ? { idp: draftIdp, policy: policyDraft(draft) }
                    : undefined
        });

        if (!result) {
            // the query only skips IdPs that aren't google/azure
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    "Directory sync is not available for this IdP type"
                )
            );
        }

        if (result.status === "skipped") {
            return next(
                result.reason === "notEntitled"
                    ? createHttpError(
                          HttpCode.FORBIDDEN,
                          "This organization's plan doesn't include the IdP API integration"
                      )
                    : createHttpError(
                          HttpCode.BAD_REQUEST,
                          "No sync role mapping is configured for this organization"
                      )
            );
        }

        if (result.status === "failed") {
            return next(
                createHttpError(
                    HttpCode.BAD_GATEWAY,
                    `Directory sync failed: ${result.error}`
                )
            );
        }

        const { entries } = result.plan;
        const counts = countSyncEntries(entries);
        const preview = dryRun ? previewChanges(entries) : undefined;

        return response<SyncOrgIdpResponse>(res, {
            data: {
                dryRun,
                counts,
                entries: preview
                    ? await summarizeEntries(preview.changes, orgId)
                    : undefined,
                entriesTruncated: preview?.truncated
            },
            success: true,
            error: false,
            message: dryRun
                ? "Directory sync preview computed"
                : "Directory sync completed",
            status: HttpCode.OK
        });
    } catch (error) {
        logger.error(error);
        return next(
            createHttpError(HttpCode.INTERNAL_SERVER_ERROR, "An error occurred")
        );
    }
}
