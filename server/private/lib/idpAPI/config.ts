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

import { decrypt, encrypt } from "@server/lib/crypto";
import config from "@server/lib/config";
import logger from "@server/logger";
import { fromError } from "zod-validation-error";
import {
    idpAPIConfigSchemas,
    variantRequiresIDPAPIConfig,
    type IDPAPIVariant
} from "@app/lib/idpApiConfig";

export function decryptIDPAPIConfig(
    encrypted: string | null
): Record<string, unknown> | null {
    if (!encrypted) return null;
    try {
        return JSON.parse(
            decrypt(encrypted, config.getRawConfig().server.secret!)
        );
    } catch (e) {
        logger.error("Directory sync: failed to decrypt stored config", e);
        return null;
    }
}

type ResolveResult =
    // `value` undefined = leave the stored column untouched
    | { success: true; value: string | undefined }
    | { success: false; error: string };

/**
 * Validates the directory sync config sent for `variant` and returns the encrypted
 * value to store. Secrets omitted from `incomingApiConfig` (e.g. the Google service account
 * key on update) are kept from the stored config.
 */
export function resolveIDPAPIConfig({
    variant,
    incomingApiConfig,
    existingEncryptedApiConfig,
    apiIntegrationEnabled
}: {
    variant: IDPAPIVariant;
    incomingApiConfig: Record<string, unknown> | undefined;
    existingEncryptedApiConfig: string | null;
    apiIntegrationEnabled: boolean;
}): ResolveResult {
    if (!variantRequiresIDPAPIConfig(variant)) {
        return { success: true, value: undefined };
    }

    const existing = decryptIDPAPIConfig(existingEncryptedApiConfig);
    const merged = incomingApiConfig
        ? {
              ...incomingApiConfig,
              serviceAccountKey:
                  incomingApiConfig.serviceAccountKey ??
                  existing?.serviceAccountKey
          }
        : existing;

    if (!merged?.serviceAccountKey) {
        if (apiIntegrationEnabled) {
            return {
                success: false,
                error: "A service account key is required to enable the API integration"
            };
        }
        // nothing worth storing yet
        return { success: true, value: undefined };
    }

    if (!incomingApiConfig) {
        return { success: true, value: undefined };
    }

    const parsed = idpAPIConfigSchemas[variant].safeParse(merged);
    if (!parsed.success) {
        return { success: false, error: fromError(parsed.error).toString() };
    }

    return {
        success: true,
        value: encrypt(
            JSON.stringify(parsed.data),
            config.getRawConfig().server.secret!
        )
    };
}
