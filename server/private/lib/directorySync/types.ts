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

import type { DirectorySyncRoleMappingConfig } from "@app/lib/idpDirectorySyncRoleMapping";

// Provider-neutral shapes used by the directory sync engine (runSync.ts).
// Each provider (Azure, Google, ...) turns its API into these.

export type DirectoryGroup = {
    /** Stable provider group ID. */
    id: string;
    displayName: string | null;
};

export type DirectoryUser = {
    /** Stable provider user ID (Entra object ID, Google directory ID). */
    externalId: string;
    /** Value that login computes as `users.username` (already resolved from `identifierPath`). */
    username: string;
    email: string | null;
    name: string | null;
    /** False when the account is disabled or suspended in the directory. */
    enabled: boolean;
    /** Every group the user belongs to, nested memberships included. */
    groups: DirectoryGroup[];
};

export type DirectoryFetchResult = {
    users: DirectoryUser[];
    // nextCursor: string | null;
};

export type DirectoryFetchContext = {
    idpId: number;
    orgId: string;
    roleMapping: DirectorySyncRoleMappingConfig;
    /** `idpOidcConfig.identifierPath`, used to compute `DirectoryUser.username`. */
    identifierPath: string;
    /** Opaque provider state from the previous successful run. Null = full fetch. */
    // cursor: string | null;
};

export interface DirectorySyncProvider {
    fetch(ctx: DirectoryFetchContext): Promise<DirectoryFetchResult>;
}

/** Thrown by a provider when the stored cursor can't be used anymore; the engine retries with a full fetch. */
export class DirectoryCursorExpiredError extends Error {}
