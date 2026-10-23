import config from "@server/lib/config";

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

export function getOfflineThresholds(): OfflineThresholds {
    const offlineChecker = config.getRawConfig().offline_checker;

    return {
        checkIntervalMs: offlineChecker.check_interval_ms,
        newtMs: offlineChecker.newt_threshold_ms,
        newtWireguardMs: offlineChecker.newt_wireguard_threshold_ms,
        olmMs: offlineChecker.olm_threshold_ms,
        remoteExitNodeMs: offlineChecker.remote_exit_node_threshold_ms
    };
}
