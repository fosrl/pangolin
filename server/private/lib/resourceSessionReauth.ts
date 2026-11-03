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

import { db, resourceSessionReauth } from "@server/db";
import { and, eq } from "drizzle-orm";

// True when an admin revoked this dashboard session's SSO access to the
// resource. The marker doesn't need clearing: logging in again creates a new
// dashboard session, and the row cascades away once the old one is deleted.
export async function isResourceReauthRequired(
    userSessionId: string,
    resourceId: number
): Promise<boolean> {
    const [row] = await db
        .select({ resourceId: resourceSessionReauth.resourceId })
        .from(resourceSessionReauth)
        .where(
            and(
                eq(resourceSessionReauth.userSessionId, userSessionId),
                eq(resourceSessionReauth.resourceId, resourceId)
            )
        )
        .limit(1);

    return !!row;
}
