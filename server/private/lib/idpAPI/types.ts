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

import type { IdpDbResponse } from "./ensureValidIdp";

// Provider-neutral shapes used by the directory sync engine (runSync.ts).
// Each provider (Azure, Google, ...) turns its API into these.

export type IDPGroup = {
    /** Stable provider group ID. */
    id: string;
    displayName: string | null;
};

export type IDPDirectoryUser = {
    /** Stable provider user ID (Entra object ID, Google directory ID). */
    externalId: string;
    /** Provider default (the email). Sync computes `users.username` from `identifierPath` on the claims instead. */
    username: string;
    email: string | null;
    name: string | null;
    /** False when the account is disabled or suspended in the directory. */
    enabled: boolean;
    /** Every group the user belongs to, nested memberships included. */
    groups: IDPGroup[];
};

export type IDPDirectoryFetchResult = {
    users: IDPDirectoryUser[];
};

export type DirectoryFetchContext = {
    /** `idpOrg.syncRoleMapping`, same format as the JIT `roleMapping`. */
    roleMapping: string | null;
    /** `idpOidcConfig.identifierPath` (the username path), evaluated on the claims to compute `users.username`. */
    identifierPath: string;
};

export abstract class IDPAPIProvider {
    constructor(public readonly idp: IdpDbResponse) {}

    abstract fetchAllDirectoryUsers(): Promise<IDPDirectoryFetchResult>;

    abstract fetchUserGroups(
        user: Pick<IDPDirectoryUser, "externalId">
    ): Promise<IDPGroup[]>;

    abstract toClaims(user: IDPDirectoryUser): object;
}
