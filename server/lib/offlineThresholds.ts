export type OfflineThresholds = {
    // how often the offline checkers run
    checkIntervalMs: number;
    // newt sites that stop pinging for this long are marked offline
    newtMs: number;
    // wireguard sites with no bandwidth update for this long are marked offline
    newtWireguardMs: number;
    // olm clients that stop pinging for this long are marked offline
    olmMs: number;
    // remote exit nodes that stop pinging for this long are marked offline
    remoteExitNodeMs: number;
};

export const DEFAULT_OFFLINE_THRESHOLDS: OfflineThresholds = {
    checkIntervalMs: 30 * 1000, // 30 seconds
    newtMs: 2 * 60 * 1000, // 2 minutes
    newtWireguardMs: 8 * 60 * 1000, // 8 minutes
    olmMs: 2 * 60 * 1000, // 2 minutes
    remoteExitNodeMs: 2 * 60 * 1000 // 2 minutes
};

// The thresholds are only configurable in the private config file, so the
// open build always uses the defaults. See server/private/lib/offlineThresholds.ts
export function getOfflineThresholds(): OfflineThresholds {
    return DEFAULT_OFFLINE_THRESHOLDS;
}
