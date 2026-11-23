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

import { z } from "zod";
import type { idpOrg } from "@server/db";
import config from "@server/lib/config";
import { encrypt } from "@server/lib/crypto";
import { resolveIDPAPIConfig } from "./config";
import type { IDPAPIProviderIdp } from "./types";

/**
 * Unsaved connection settings from the IdP form, so the API test and the sync
 * preview run on what the admin is editing instead of what's saved. Same names
 * as the update endpoints. Empty or omitted values keep the saved ones.
 */
export const idpApiDraftSchema = z.strictObject({
    clientId: z.string().optional(),
    clientSecret: z.string().optional(),
    authUrl: z.string().optional(),
    tokenUrl: z.string().optional(),
    // provider-specific, an omitted secret (Google key) keeps the saved one
    apiConfig: z.record(z.string(), z.unknown()).optional()
});

/** The connection settings, plus what the sync preview depends on. */
export const idpSyncDraftSchema = z.strictObject({
    ...idpApiDraftSchema.shape,
    identifierPath: z.string().optional(),
    directorySyncDeletions: z.boolean().optional(),
    // org IdPs only: the org's policy
    roleMapping: z.string().nullish(),
    syncRoleMapping: z.string().nullish(),
    mappingsLinked: z.boolean().optional(),
    createMissingRoles: z.boolean().optional(),
    syncCreateMissingRoles: z.boolean().optional()
});

/** Global IdPs: the mappings are on the policies page, not in the form being previewed. */
export const globalIdpSyncDraftSchema = idpSyncDraftSchema.pick({
    clientId: true,
    clientSecret: true,
    authUrl: true,
    tokenUrl: true,
    apiConfig: true,
    identifierPath: true,
    directorySyncDeletions: true
});

export type IdpApiDraft = z.infer<typeof idpApiDraftSchema>;
export type IdpSyncDraft = z.infer<typeof idpSyncDraftSchema>;

type IdpOrgPolicy = typeof idpOrg.$inferSelect;

/**
 * The saved IdP rows with the draft applied, in memory only. The API
 * integration counts as on: the admin is testing it before saving.
 */
export function applyIdpDraft(
    saved: IDPAPIProviderIdp,
    draft: IdpApiDraft &
        Partial<Pick<IdpSyncDraft, "identifierPath" | "directorySyncDeletions">>
):
    | { success: true; value: IDPAPIProviderIdp }
    | { success: false; error: string } {
    const key = config.getRawConfig().server.secret!;
    const idp = { ...saved.idp, apiIntegrationEnabled: true };
    const idpOidcConfig = { ...saved.idpOidcConfig };

    if (draft.clientId) {
        idpOidcConfig.clientId = encrypt(draft.clientId, key);
    }
    if (draft.clientSecret) {
        idpOidcConfig.clientSecret = encrypt(draft.clientSecret, key);
    }
    if (draft.authUrl) {
        idpOidcConfig.authUrl = draft.authUrl;
    }
    if (draft.tokenUrl) {
        idpOidcConfig.tokenUrl = draft.tokenUrl;
    }
    if (draft.identifierPath) {
        idpOidcConfig.identifierPath = draft.identifierPath;
    }
    if (draft.directorySyncDeletions !== undefined) {
        idp.directorySyncDeletions = draft.directorySyncDeletions;
    }

    const apiConfig = resolveIDPAPIConfig({
        variant: idpOidcConfig.variant ?? "oidc",
        incomingApiConfig: draft.apiConfig,
        existingEncryptedApiConfig: saved.idp.apiConfig,
        apiIntegrationEnabled: true
    });
    if (!apiConfig.success) {
        return { success: false, error: apiConfig.error };
    }
    if (apiConfig.value !== undefined) {
        idp.apiConfig = apiConfig.value;
    }

    return { success: true, value: { idp, idpOidcConfig } };
}

/** The org policy fields of the draft (org IdPs), applied over the saved policy by the sync preview. */
export function policyDraft(draft: IdpSyncDraft): Partial<IdpOrgPolicy> {
    const policy: Partial<IdpOrgPolicy> = {};
    if (draft.roleMapping !== undefined) {
        policy.roleMapping = draft.roleMapping;
    }
    if (draft.syncRoleMapping !== undefined) {
        policy.syncRoleMapping = draft.syncRoleMapping;
    }
    if (draft.mappingsLinked !== undefined) {
        policy.mappingsLinked = draft.mappingsLinked;
    }
    if (draft.createMissingRoles !== undefined) {
        policy.createMissingRoles = draft.createMissingRoles;
    }
    if (draft.syncCreateMissingRoles !== undefined) {
        policy.syncCreateMissingRoles = draft.syncCreateMissingRoles;
    }
    if (draft.directorySyncDeletions !== undefined) {
        policy.directorySyncDeletions = draft.directorySyncDeletions;
    }
    return policy;
}
