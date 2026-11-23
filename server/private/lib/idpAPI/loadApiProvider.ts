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
import { getIDPAPIProvider } from "./providers";
import type { IDPAPIProvider } from "./types";

/**
 * The API provider of an IdP whose API integration is saved as enabled, or an
 * HTTP error to pass to `next` (not found, unsupported variant, not enabled).
 */
export async function loadEnabledApiProvider(
    idpId: number
): Promise<IDPAPIProvider | createHttpError.HttpError> {
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
    if (!data.idp.apiIntegrationEnabled) {
        return createHttpError(
            HttpCode.BAD_REQUEST,
            "The API integration is not enabled for this IdP"
        );
    }

    const provider = getIDPAPIProvider(data);
    if (!provider) {
        return createHttpError(
            HttpCode.BAD_REQUEST,
            "The API integration is not available for this IdP type"
        );
    }
    return provider;
}
