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
    directorySyncConfigSchemas,
    variantRequiresDirectorySyncConfig,
    type DirectorySyncVariant
} from "@app/lib/idpDirectorySyncConfig";

export function decryptDirectorySyncConfig(
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
    { success: true; value: string | undefined } | { success: false; error: string };

/**
 * Validates the directory sync config sent for `variant` and returns the encrypted
 * value to store. Secrets omitted from `incoming` (e.g. the Google service account
 * key on update) are kept from the stored config.
 */
export function resolveDirectorySyncConfig({
    variant,
    incoming,
    existingEncrypted,
    directorySyncEnabled
}: {
    variant: DirectorySyncVariant;
    incoming: Record<string, unknown> | undefined;
    existingEncrypted: string | null;
    directorySyncEnabled: boolean;
}): ResolveResult {
    if (!variantRequiresDirectorySyncConfig(variant)) {
        return { success: true, value: undefined };
    }

    const existing = decryptDirectorySyncConfig(existingEncrypted);
    const merged = incoming
        ? {
              ...incoming,
              serviceAccountKey:
                  incoming.serviceAccountKey ?? existing?.serviceAccountKey
          }
        : existing;

    if (!merged?.serviceAccountKey) {
        if (directorySyncEnabled) {
            return {
                success: false,
                error: "A service account key is required to enable directory sync"
            };
        }
        // nothing worth storing yet
        return { success: true, value: undefined };
    }

    if (!incoming) {
        return { success: true, value: undefined };
    }

    const parsed = directorySyncConfigSchemas[variant].safeParse(merged);
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
