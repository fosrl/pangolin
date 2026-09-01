import { ExitNode, exitNodes, Newt, Site, db } from "@server/db";
import { eq } from "drizzle-orm";
import { sendToClient } from "#dynamic/routers/ws";
import logger from "@server/logger";
import {
    buildClientConfigurationForNewtClient,
    buildTargetConfigurationForNewtClient
} from "./buildConfiguration";
import {
    canCompress,
    supportsCertReferences
} from "@server/lib/clientVersionChecks";
import { dedupeCertsForTargets } from "@server/lib/ip";

export async function sendNewtSyncMessage(newt: Newt, site: Site) {
    const {
        tcpTargets,
        udpTargets,
        validHealthCheckTargets,
        browserGatewayTargets,
        remoteExitNodeSubnets
    } = await buildTargetConfigurationForNewtClient(site.siteId);
    let exitNode: ExitNode | undefined;
    if (site.exitNodeId) {
        [exitNode] = await db
            .select()
            .from(exitNodes)
            .where(eq(exitNodes.exitNodeId, site.exitNodeId))
            .limit(1);
    }
    const { peers, targets } = await buildClientConfigurationForNewtClient(
        site,
        exitNode
    );

    // Older newt clients only understand inline tlsCert/tlsKey on each
    // target, so only switch to certId references once we know the client
    // can resolve them.
    let clientTargets = targets;
    let certs: { id: string; cert: string; key: string }[] = [];
    if (supportsCertReferences(newt.version)) {
        ({ targets: clientTargets, certs } = dedupeCertsForTargets(targets));
    }

    await sendToClient(
        newt.newtId,
        {
            type: "newt/sync",
            data: {
                proxyTargets: {
                    udp: udpTargets,
                    tcp: tcpTargets
                },
                healthCheckTargets: validHealthCheckTargets,
                peers: peers,
                clientTargets: clientTargets,
                certs: certs,
                browserGatewayTargets: browserGatewayTargets,
                remoteExitNodeSubnets: remoteExitNodeSubnets
            }
        },
        {
            compress: canCompress(newt.version, "newt")
        }
    ).catch((error) => {
        logger.warn(`Error sending newt sync message:`, error);
    });
}
