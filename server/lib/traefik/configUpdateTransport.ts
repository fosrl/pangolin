import logger from "@server/logger";

/**
 * Delivers "your traefik config changed, pull it now" signals to the
 * TraefikConfigManager running on each exit node. A channel is either an
 * exit node ID (only that node reloads) or "all".
 *
 * This is the OSS build: the API and the TraefikConfigManager always run in
 * the same process, so the signal is delivered in-process. The enterprise
 * build (server/private/lib/traefik/configUpdateTransport.ts) sends it over
 * Redis pub/sub so it reaches nodes running in other processes.
 */

export type TraefikConfigUpdateChannel = number | "all";

export type TraefikConfigUpdateHandler = (reason: string) => void;

const localHandlers = new Map<string, Set<TraefikConfigUpdateHandler>>();

export function publishLocalTraefikConfigUpdate(
    channels: TraefikConfigUpdateChannel[],
    reason: string
): void {
    // a handler subscribed to several of the channels only runs once
    const toCall = new Set<TraefikConfigUpdateHandler>();
    const keys = channels.includes("all")
        ? Array.from(localHandlers.keys())
        : channels.map(String);
    for (const key of keys) {
        localHandlers.get(key)?.forEach((handler) => toCall.add(handler));
    }
    for (const handler of toCall) {
        try {
            handler(reason);
        } catch (error) {
            logger.error("Error in traefik config update handler:", error);
        }
    }
}

export function subscribeLocalTraefikConfigUpdates(
    channel: TraefikConfigUpdateChannel,
    handler: TraefikConfigUpdateHandler
): void {
    const key = String(channel);
    if (!localHandlers.has(key)) {
        localHandlers.set(key, new Set());
    }
    localHandlers.get(key)!.add(handler);
}

export function unsubscribeLocalTraefikConfigUpdates(
    channel: TraefikConfigUpdateChannel,
    handler: TraefikConfigUpdateHandler
): void {
    const key = String(channel);
    const handlers = localHandlers.get(key);
    if (!handlers) return;
    handlers.delete(handler);
    if (handlers.size === 0) {
        localHandlers.delete(key);
    }
}

export async function publishTraefikConfigUpdate(
    channels: TraefikConfigUpdateChannel[],
    reason: string
): Promise<void> {
    publishLocalTraefikConfigUpdate(channels, reason);
}

/**
 * Returns true once the handler is subscribed. Callers retry on false.
 */
export async function subscribeTraefikConfigUpdates(
    channel: TraefikConfigUpdateChannel,
    handler: TraefikConfigUpdateHandler
): Promise<boolean> {
    subscribeLocalTraefikConfigUpdates(channel, handler);
    return true;
}

export async function unsubscribeTraefikConfigUpdates(
    channel: TraefikConfigUpdateChannel,
    handler: TraefikConfigUpdateHandler
): Promise<void> {
    unsubscribeLocalTraefikConfigUpdates(channel, handler);
}
