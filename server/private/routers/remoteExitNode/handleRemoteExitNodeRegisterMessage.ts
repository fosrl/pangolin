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

import { db, RemoteExitNode, remoteExitNodes } from "@server/db";
import { MessageHandler } from "@server/routers/ws";
import { eq } from "drizzle-orm";
import logger from "@server/logger";

export const handleRemoteExitNodeRegisterMessage: MessageHandler = async (
    context
) => {
    const { message, client, sendToClient } = context;
    const remoteExitNode = client as RemoteExitNode;

    logger.debug("Handling register remoteExitNode message!");

    if (!remoteExitNode) {
        logger.warn("Remote exit node not found");
        return;
    }

    const { remoteExitNodeVersion, remoteExitNodeSecondaryVersion } = message.data;

    if (!remoteExitNodeVersion) {
        logger.warn("Remote exit node version not found");
        return;
    }

    // update the version
    await db
        .update(remoteExitNodes)
        .set({ version: remoteExitNodeVersion, secondaryVersion: remoteExitNodeSecondaryVersion })
        .where(
            eq(
                remoteExitNodes.remoteExitNodeId,
                remoteExitNode.remoteExitNodeId
            )
        );
};
