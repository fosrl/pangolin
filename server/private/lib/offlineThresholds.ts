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

import type { OfflineThresholds } from "@server/lib/offlineThresholds";
import privateConfig from "#private/lib/config";

export function getOfflineThresholds(): OfflineThresholds {
    const offlineChecker = privateConfig.getRawPrivateConfig().offline_checker;

    return {
        checkIntervalMs: offlineChecker.check_interval_ms,
        newtMs: offlineChecker.newt_threshold_ms,
        newtWireguardMs: offlineChecker.newt_wireguard_threshold_ms,
        olmMs: offlineChecker.olm_threshold_ms,
        remoteExitNodeMs: offlineChecker.remote_exit_node_threshold_ms
    };
}
