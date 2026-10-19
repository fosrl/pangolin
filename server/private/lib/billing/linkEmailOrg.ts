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
import privateConfig from "#private/lib/config";
import { build } from "@server/build";

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
        const response = await fetch(
            `${privateConfig.getRawPrivateConfig().server.fossorial_api}/api/v1/license-internal/enterprise/link-email-org`,
            {
                method: "POST",
                headers: {
                    "api-key":
                        privateConfig.getRawPrivateConfig().server
                            .fossorial_api_key!,
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({ email, orgId })
            }
        );

        if (!response.ok && response.status !== 404) {
            logger.error(
                `Fossorial API returned ${response.status} when linking email ${email} to orgId ${orgId}: ${await response.text()}`
            );
        }
    } catch (error) {
        logger.error(
            `Error notifying Fossorial API of email/org link for orgId ${orgId}:`,
            error
        );
    }
}
