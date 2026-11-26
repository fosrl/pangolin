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

import {
    supportsApiIntegration,
    type APIIntegrationVariant
} from "@app/lib/idpApiConfig";
import { AzureDirectorySyncProvider } from "./azure";
import { GoogleDirectorySyncProvider } from "./google";
import type {
    IDPAPIProvider,
    IDPAPIProviderIdp,
    IDPAPIProviderOptions
} from "./types";

/** The provider class of each variant in `API_INTEGRATION_VARIANTS`. */
export const idpAPIProviderClasses = {
    azure: AzureDirectorySyncProvider,
    google: GoogleDirectorySyncProvider
} satisfies Record<
    APIIntegrationVariant,
    new (
        idp: IDPAPIProviderIdp,
        options?: IDPAPIProviderOptions
    ) => IDPAPIProvider
>;

/** The API provider for this IdP, `null` when its variant has no API integration. */
export function getIDPAPIProvider(
    idp: IDPAPIProviderIdp,
    options?: IDPAPIProviderOptions
): IDPAPIProvider | null {
    const variant = idp.idpOidcConfig.variant;
    if (!supportsApiIntegration(variant)) {
        return null;
    }
    return new idpAPIProviderClasses[variant](idp, options);
}
