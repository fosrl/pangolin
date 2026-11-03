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

// Imported first by dnsServer.ts: modules evaluate in import order, so this
// runs before any later import loads (and validates) the config.
import { setRunMode } from "@server/lib/runMode";

setRunMode("dns");
