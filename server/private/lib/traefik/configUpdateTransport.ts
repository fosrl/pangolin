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
import { redisManager } from "#private/lib/redis";
import {
    publishLocalTraefikConfigUpdate,
    subscribeLocalTraefikConfigUpdates,
    unsubscribeLocalTraefikConfigUpdates,
    type TraefikConfigUpdateChannel,
    type TraefikConfigUpdateHandler
} from "@server/lib/traefik/configUpdateTransport";

export type {
    TraefikConfigUpdateChannel,
    TraefikConfigUpdateHandler
} from "@server/lib/traefik/configUpdateTransport";

/**
 * Enterprise/SaaS transport for traefik config update signals. With Redis
 * enabled, every exit node's TraefikConfigManager subscribes to its own
 * channel plus the "all" channel, so a change only wakes the nodes that
 * serve it. Without Redis there is a single process, so the signal is
 * delivered in-process like the OSS build.
 */

const CHANNEL_PREFIX = "traefik:config-update:";

function channelName(channel: TraefikConfigUpdateChannel): string {
    return `${CHANNEL_PREFIX}${channel}`;
}

type UpdateMessage = {
    reason: string;
};

// redisManager callbacks receive (channel, message); keep the wrapper per
// handler so unsubscribe removes the right one
const redisCallbacks = new Map<
    string,
    Map<TraefikConfigUpdateHandler, (channel: string, message: string) => void>
>();

export async function publishTraefikConfigUpdate(
    channels: TraefikConfigUpdateChannel[],
    reason: string
): Promise<void> {
    if (!redisManager.isRedisEnabled()) {
        publishLocalTraefikConfigUpdate(channels, reason);
        return;
    }

    // "all" already reaches every node, no need to also hit node channels
    const targets: TraefikConfigUpdateChannel[] = channels.includes("all")
        ? ["all"]
        : Array.from(new Set(channels));

    const message: UpdateMessage = { reason };
    const payload = JSON.stringify(message);

    await Promise.all(
        targets.map(async (channel) => {
            const ok = await redisManager.publish(
                channelName(channel),
                payload
            );
            if (!ok) {
                logger.warn(
                    `Failed to publish traefik config update to ${channelName(channel)}; the node will pick it up on its next poll`
                );
            }
        })
    );
}

export async function subscribeTraefikConfigUpdates(
    channel: TraefikConfigUpdateChannel,
    handler: TraefikConfigUpdateHandler
): Promise<boolean> {
    if (!redisManager.isRedisEnabled()) {
        subscribeLocalTraefikConfigUpdates(channel, handler);
        return true;
    }

    const name = channelName(channel);
    let callbacks = redisCallbacks.get(name);
    if (callbacks?.has(handler)) {
        return true;
    }

    const callback = (_channel: string, message: string) => {
        let reason = "unknown";
        try {
            reason = (JSON.parse(message) as UpdateMessage).reason ?? reason;
        } catch {
            // the signal itself is what matters, not the payload
        }
        handler(reason);
    };

    const ok = await redisManager.subscribe(name, callback);
    if (!ok) {
        return false;
    }

    if (!callbacks) {
        callbacks = new Map();
        redisCallbacks.set(name, callbacks);
    }
    callbacks.set(handler, callback);
    return true;
}

export async function unsubscribeTraefikConfigUpdates(
    channel: TraefikConfigUpdateChannel,
    handler: TraefikConfigUpdateHandler
): Promise<void> {
    unsubscribeLocalTraefikConfigUpdates(channel, handler);

    const name = channelName(channel);
    const callbacks = redisCallbacks.get(name);
    const callback = callbacks?.get(handler);
    if (!callbacks || !callback) return;

    callbacks.delete(handler);
    if (callbacks.size === 0) {
        redisCallbacks.delete(name);
    }
    await redisManager.unsubscribe(name, callback);
}
