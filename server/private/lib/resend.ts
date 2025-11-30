/*
 * This file is part of a proprietary work.
 *
 * Copyright (c) 2025 Fossorial, Inc.
 * All rights reserved.
 *
 * This file is licensed under the Fossorial Commercial License.
 * You may not use this file except in compliance with the License.
 * Unauthorized use, copying, modification, or distribution is strictly prohibited.
 *
 * This file is not licensed under the AGPLv3.
 */

import { Resend } from "resend";
import privateConfig from "#private/lib/config";
import logger from "@server/logger";

export enum AudienceIds {
  SignUps = "6c4e77b2-0851-4bd6-bac8-f51f91360f1a",
  Subscribed = "870b43fd-387f-44de-8fc1-707335f30b20",
  Churned = "f3ae92bd-2fdb-4d77-8746-2118afd62549",
  Newsletter = "5500c431-191c-42f0-a5d4-8b6d445b4ea0"
}

const resend = new Resend(
    privateConfig.getRawPrivateConfig().server.resend_api_key || "missing"
);

export default resend;

export async function moveEmailToAudience(
    email: string,
    audienceId: AudienceIds
) {
    if (process.env.ENVIRONMENT !== "prod") {
        logger.debug(`Skipping moving email ${email} to audience ${audienceId} in non-prod environment`);
        return;
    }
    const { error, data } = await retryWithBackoff(async () => {
        const { data, error } = await resend.contacts.create({
            email,
            unsubscribed: false,
            audienceId
        });
        if (error) {
            throw new Error(
                `Error adding email ${email} to audience ${audienceId}: ${error}`
            );
        }
        return { error, data };
    });

    if (error) {
        logger.error(
            `Error adding email ${email} to audience ${audienceId}: ${error}`
        );
        return;
    }

    if (data) {
        logger.debug(
            `Added email ${email} to audience ${audienceId} with contact ID ${data.id}`
        );
    }

    const otherAudiences = Object.values(AudienceIds).filter(
        (id) => id !== audienceId
    );

    for (const otherAudienceId of otherAudiences) {
        const { error, data } = await retryWithBackoff(async () => {
            const { data, error } = await resend.contacts.remove({
                email,
                audienceId: otherAudienceId
            });
            if (error) {
                throw new Error(
                    `Error removing email ${email} from audience ${otherAudienceId}: ${error}`
                );
            }
            return { error, data };
        });

        if (error) {
            logger.error(
                `Error removing email ${email} from audience ${otherAudienceId}: ${error}`
            );
        }

        if (data) {
            logger.info(
                `Removed email ${email} from audience ${otherAudienceId}`
            );
        }
    }
}

type RetryOptions = {
    retries?: number;
    initialDelayMs?: number;
    factor?: number;
};

export async function retryWithBackoff<T>(
    fn: () => Promise<T>,
    options: RetryOptions = {}
): Promise<T> {
    const { retries = 5, initialDelayMs = 500, factor = 2 } = options;

    let attempt = 0;
    let delay = initialDelayMs;

    while (true) {
        try {
            return await fn();
        } catch (err) {
            attempt++;

            if (attempt > retries) throw err;

            await new Promise((resolve) => setTimeout(resolve, delay));
            delay *= factor;
        }
    }
}
