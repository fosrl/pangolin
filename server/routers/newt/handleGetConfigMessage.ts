import { z } from "zod";
import { MessageHandler } from "@server/routers/ws";
import logger from "@server/logger";
import { fromError } from "zod-validation-error";
import { db, ExitNode, exitNodes, Newt, sites } from "@server/db";
import { eq } from "drizzle-orm";
import { sendToExitNode } from "#dynamic/lib/exitNodes";
import { buildClientConfigurationForNewtClient } from "./buildConfiguration";
import { canCompress } from "@server/lib/clientVersionChecks";

export const handleGetConfigMessage: MessageHandler = async (context) => {
    const { message, client, sendToClient } = context;
    const newt = client as Newt;

    const now = new Date().getTime() / 1000;

    logger.debug("Handling Newt get config message!");

    if (!newt) {
        logger.warn("Newt not found");
        return;
    }

    if (!newt.siteId) {
        logger.warn("Newt has no site!"); // TODO: Maybe we create the site here?
        return;
    }

    const { publicKey, port, chainId } = message.data;
    const siteId = newt.siteId;

    // Get the current site data
    const [existingSite] = await db
        .select()
        .from(sites)
        .where(eq(sites.siteId, siteId));

    if (!existingSite) {
        logger.warn("handleGetConfigMessage: Site not found");
        return;
    }

    // we need to wait for hole punch success
    if (!existingSite.endpoint) {
        logger.debug(
            `In newt get config: existing site ${existingSite.siteId} has no endpoint, skipping`
        );
        return;
    }

    if (existingSite.publicKey !== publicKey) {
        // TODO: somehow we should make sure a recent hole punch has happened if this occurs (hole punch could be from the last restart if done quickly)
    }

    if (existingSite.lastHolePunch && now - existingSite.lastHolePunch > 5) {
        logger.warn(
            `handleGetConfigMessage: Site ${existingSite.siteId} last hole punch is too old, skipping`
        );
        return;
    }

    // update the endpoint and the public key
    const [site] = await db
        .update(sites)
        .set({
            publicKey,
            listenPort: port
        })
        .where(eq(sites.siteId, siteId))
        .returning();

    if (!site) {
        logger.error("handleGetConfigMessage: Failed to update site");
        return;
    }

    let exitNode: ExitNode | undefined;
    if (site.exitNodeId) {
        [exitNode] = await db
            .select()
            .from(exitNodes)
            .where(eq(exitNodes.exitNodeId, site.exitNodeId))
            .limit(1);
        if (
            exitNode.reachableAt &&
            existingSite.subnet &&
            existingSite.listenPort
        ) {
            const payload = {
                oldDestination: {
                    destinationIP: existingSite.subnet?.split("/")[0],
                    destinationPort: existingSite.listenPort || 1 // this satisfies gerbil for now but should be reevaluated
                },
                newDestination: {
                    destinationIP: site.subnet?.split("/")[0],
                    destinationPort: site.listenPort || 1 // this satisfies gerbil for now but should be reevaluated
                }
            };

            await sendToExitNode(exitNode, {
                remoteType: "remoteExitNode/update-proxy-mapping",
                localPath: "/update-proxy-mapping",
                method: "POST",
                data: payload
            });
        }
    }

    const { peers, targets } = await buildClientConfigurationForNewtClient(
        site,
        exitNode
    );

    return {
        message: {
            type: "newt/wg/receive-config",
            data: {
                ipAddress: site.address,
                peers,
                targets,
                chainId: chainId
            }
        },
        options: {
            compress: canCompress(newt.version, "newt")
        },
        broadcast: false,
        excludeSender: false
    };
};
