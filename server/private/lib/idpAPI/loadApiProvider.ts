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

import { db, idp, idpOidcConfig } from "@server/db";
import HttpCode from "@server/types/HttpCode";
import createHttpError from "http-errors";
import { eq } from "drizzle-orm";
import { supportsApiIntegration } from "@app/lib/idpApiConfig";
import { applyIdpDraft, type IdpSyncDraft } from "./draft";
import { getIDPAPIProvider } from "./providers";
import type { IDPAPIProvider, IDPAPIProviderIdp } from "./types";

/**
 * The IdP rows the API integration runs on, or an HTTP error to pass to `next`.
 *
 * - Without `draft`: the saved rows, whose API integration must be saved as on.
 * - With `draft`: the saved rows with the unsaved form values applied (in
 *   memory). The integration may not be saved as on yet: that's being tested.
 */
export async function loadApiIdp(
    idpId: number,
    draft?: Partial<IdpSyncDraft>
): Promise<IDPAPIProviderIdp | createHttpError.HttpError> {
    const [data] = await db
        .select()
        .from(idp)
        .innerJoin(idpOidcConfig, eq(idpOidcConfig.idpId, idp.idpId))
        .where(eq(idp.idpId, idpId))
        .limit(1);

    if (!data) {
        return createHttpError(
            HttpCode.NOT_FOUND,
            `IdP with ID ${idpId} not found`
        );
    }
    if (!supportsApiIntegration(data.idpOidcConfig.variant)) {
        return createHttpError(
            HttpCode.BAD_REQUEST,
            "The API integration is not available for this IdP type"
        );
    }

    if (draft) {
        const applied = applyIdpDraft(data, draft);
        if (!applied.success) {
            return createHttpError(HttpCode.BAD_REQUEST, applied.error);
        }
        return applied.value;
    }

    if (!data.idp.apiIntegrationEnabled) {
        return createHttpError(
            HttpCode.BAD_REQUEST,
            "The API integration is not enabled for this IdP"
        );
    }
    return data;
}

/** The API provider of `loadApiIdp`. A draft provider never uses the token cache. */
export async function loadApiProvider(
    idpId: number,
    draft?: Partial<IdpSyncDraft>
): Promise<IDPAPIProvider | createHttpError.HttpError> {
    const data = await loadApiIdp(idpId, draft);
    if (data instanceof Error) {
        return data;
    }

    const provider = getIDPAPIProvider(
        data,
        draft ? { tokenCache: false } : undefined
    );
    if (!provider) {
        return createHttpError(
            HttpCode.BAD_REQUEST,
            "The API integration is not available for this IdP type"
        );
    }
    return provider;
}
