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
import { db, idp, idpOidcConfig, orgs } from "@server/db";
import response from "@server/lib/response";
import HttpCode from "@server/types/HttpCode";
import createHttpError from "http-errors";
import logger from "@server/logger";
import { fromError } from "zod-validation-error";
import { eq, inArray } from "drizzle-orm";
import { OpenAPITags, registry } from "@server/openApi";
import { isOrgIdentityProviderMode } from "@server/lib/idp/idpExistsForOrg";
import { runIdpDirectorySync } from "#private/lib/idpAPI/syncWorkflow";
import {
    countSyncEntries,
    emptySyncCounts,
    previewChanges,
    summarizeEntries,
    type SyncCounts,
    type SyncEntrySummary
} from "#private/lib/idpAPI/syncSummary";
import { supportsApiIntegration } from "@app/lib/idpApiConfig";
import { globalIdpSyncDraftSchema } from "#private/lib/idpAPI/draft";
import { loadApiIdp } from "#private/lib/idpAPI/loadApiProvider";

const paramsSchema = z
    .object({
        idpId: z.coerce.number<number>().int().positive()
    })
    .strict();

const bodySchema = z.strictObject({
    dryRun: z.boolean().optional().default(false),
    /** Only sync this org. */
    orgId: z.string().nonempty().optional(),
    /** Dry run only: preview these unsaved form values instead of the saved settings. */
    draft: globalIdpSyncDraftSchema.optional()
});

export type SyncIdpOrgResult = {
    orgId: string;
    orgName: string;
} & (
    | {
          status: "synced";
          counts: SyncCounts;
          /** Only for a dry run: the membership changes, at most `MAX_PREVIEW_ENTRIES`. */
          entries?: SyncEntrySummary[];
          /** Only for a dry run: some changes aren't in `entries` (the counts still include them). */
          entriesTruncated?: boolean;
      }
    | { status: "skipped"; reason: "notEntitled" | "noRoleMapping" }
    | { status: "failed"; error: string }
);

export type SyncIdpResponse = {
    dryRun: boolean;
    /** Totals over the synced orgs. */
    counts: SyncCounts;
    orgs: SyncIdpOrgResult[];
};

registry.registerPath({
    method: "post",
    path: "/idp/{idpId}/sync",
    description:
        "Run the directory sync of a global IdP now, for every organization it maps users into. With `dryRun`, returns what would change without writing anything.",
    tags: [OpenAPITags.GlobalIdp],
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

export async function syncIdp(
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

        const { idpId } = parsedParams.data;
        const { dryRun, orgId, draft } = parsedBody.data;

        if (draft && !dryRun) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    "Unsaved settings can only be previewed (dryRun)"
                )
            );
        }

        if (isOrgIdentityProviderMode()) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    "Global IdPs are not available in the current identity provider mode, use the organization sync endpoint instead"
                )
            );
        }

        const [existing] = await db
            .select({
                apiIntegrationEnabled: idp.apiIntegrationEnabled,
                directorySyncEnabled: idp.directorySyncEnabled,
                variant: idpOidcConfig.variant
            })
            .from(idp)
            .innerJoin(idpOidcConfig, eq(idpOidcConfig.idpId, idp.idpId))
            .where(eq(idp.idpId, idpId))
            .limit(1);

        if (!existing) {
            return next(
                createHttpError(
                    HttpCode.NOT_FOUND,
                    `IdP with ID ${idpId} not found`
                )
            );
        }

        if (!supportsApiIntegration(existing.variant)) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    "Directory sync is not available for this IdP type"
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

        const results = await runIdpDirectorySync({
            dryRun,
            idpId,
            orgId,
            draft: draftIdp ? { idp: draftIdp } : undefined
        });

        const orgNames = new Map(
            results.length === 0
                ? []
                : (
                      await db
                          .select({ orgId: orgs.orgId, name: orgs.name })
                          .from(orgs)
                          .where(
                              inArray(
                                  orgs.orgId,
                                  results.map((r) => r.orgId)
                              )
                          )
                  ).map((o) => [o.orgId, o.name])
        );

        const counts = emptySyncCounts();
        const orgResults: SyncIdpOrgResult[] = [];
        for (const result of results) {
            const org = {
                orgId: result.orgId,
                orgName: orgNames.get(result.orgId) ?? result.orgId
            };
            switch (result.status) {
                case "synced": {
                    const { entries } = result.plan;
                    countSyncEntries(entries, counts);
                    // the preview lists changes only, a global IdP can cover many orgs
                    const preview = dryRun
                        ? previewChanges(entries)
                        : undefined;
                    orgResults.push({
                        ...org,
                        status: "synced",
                        counts: countSyncEntries(entries),
                        entries: preview
                            ? await summarizeEntries(
                                  preview.changes,
                                  result.orgId
                              )
                            : undefined,
                        entriesTruncated: preview?.truncated
                    });
                    break;
                }
                case "skipped":
                    orgResults.push({
                        ...org,
                        status: "skipped",
                        reason: result.reason
                    });
                    break;
                case "failed":
                    orgResults.push({
                        ...org,
                        status: "failed",
                        error: result.error
                    });
                    break;
            }
        }

        return response<SyncIdpResponse>(res, {
            data: { dryRun, counts, orgs: orgResults },
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
