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

import { build } from "@server/build";
import { startRemoteExitNodeOfflineChecker } from "./routers/remoteExitNode";
import { startExitNodeReconnectScheduler } from "./routers/remoteExitNode/exitNodeReconnectScheduler";
import { startSchedulers as ossStartSchedulers } from "@server/startSchedulers";

export function startSchedulers() {
    if (build != "saas") {
        startRemoteExitNodeOfflineChecker(); // this is to handle the offline check for remote exit nodes
        startExitNodeReconnectScheduler(); // check pending exit node reconnects and notify newts
    }
    ossStartSchedulers();
}
