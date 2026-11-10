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

import logger from "@server/logger";
import { build } from "@server/build";
import { linkLicenseEmail } from "./licenseApi";

/**
 * Links license keys bought on the website with this email (and not linked
 * to an org yet) to the account's first org.
 */
export async function linkEmailOrg(
    orgId: string,
    email: string | null | undefined
): Promise<void> {
    if (build !== "saas") {
        return;
    }

    if (!email) {
        return;
    }

    try {
        const result = await linkLicenseEmail({ email, orgId });
        if (!result.ok && result.status !== 404) {
            logger.error(
                `Fossorial API returned ${result.status} when linking email ${email} to orgId ${orgId}: ${result.body}`
            );
        }
    } catch (error) {
        logger.error(
            `Error notifying Fossorial API of email/org link for orgId ${orgId}:`,
            error
        );
    }
}
