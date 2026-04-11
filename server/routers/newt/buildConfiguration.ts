import {
    clients,
    clientSiteResourcesAssociationsCache,
    clientSitesAssociationsCache,
    db,
    ExitNode,
    resources,
    Site,
    siteResources,
    targetHealthCheck,
    targets
} from "@server/db";
import logger from "@server/logger";
import { initPeerAddHandshake, updatePeer } from "../olm/peers";
import { eq, and } from "drizzle-orm";
import config from "@server/lib/config";
import {
    formatEndpoint,
    generateSubnetProxyTargetV2,
    SubnetProxyTargetV2
} from "@server/lib/ip";

export async function buildClientConfigurationForNewtClient(
    site: Site,
    exitNode?: ExitNode
) {
    const siteId = site.siteId;

    // Get all clients connected to this site
    const clientsRes = await db
        .select()
        .from(clients)
        .innerJoin(
            clientSitesAssociationsCache,
            eq(clients.clientId, clientSitesAssociationsCache.clientId)
        )
        .where(eq(clientSitesAssociationsCache.siteId, siteId));

    let peers: Array<{
        publicKey: string;
        allowedIps: string[];
        endpoint?: string;
    }> = [];

    if (site.publicKey && site.endpoint && exitNode) {
        // Prepare peers data for the response
        peers = await Promise.all(
            clientsRes
                .filter((client) => {
                    if (!client.clients.pubKey) {
                        logger.warn(
                            `Client ${client.clients.clientId} has no public key, skipping`
                        );
                        return false;
                    }
                    if (!client.clients.subnet) {
                        logger.warn(
                            `Client ${client.clients.clientId} has no subnet, skipping`
                        );
                        return false;
                    }
                    return true;
                })
                .map(async (client) => {
                    // Add or update this peer on the olm if it is connected

                    // const allSiteResources = await db // only get the site resources that this client has access to
                    //     .select()
                    //     .from(siteResources)
                    //     .innerJoin(
                    //         clientSiteResourcesAssociationsCache,
                    //         eq(
                    //             siteResources.siteResourceId,
                    //             clientSiteResourcesAssociationsCache.siteResourceId
                    //         )
                    //     )
                    //     .where(
                    //         and(
                    //             eq(siteResources.siteId, site.siteId),
                    //             eq(
                    //                 clientSiteResourcesAssociationsCache.clientId,
                    //                 client.clients.clientId
                    //             )
                    //         )
                    //     );

                    if (!client.clientSitesAssociationsCache.isJitMode) { // if we are adding sites through jit then dont add the site to the olm
                        // update the peer info on the olm
                        // if the peer has not been added yet this will be a no-op
                        await updatePeer(client.clients.clientId, {
                            siteId: site.siteId,
                            endpoint: site.endpoint!,
                            relayEndpoint: `${exitNode.endpoint}:${config.getRawConfig().gerbil.clients_start_port}`,
                            publicKey: site.publicKey!,
                            serverIP: site.address,
                            serverPort: site.listenPort
                            // remoteSubnets: generateRemoteSubnets(
                            //     allSiteResources.map(
                            //         ({ siteResources }) => siteResources
                            //     )
                            // ),
                            // aliases: generateAliasConfig(
                            //     allSiteResources.map(
                            //         ({ siteResources }) => siteResources
                            //     )
                            // )
                        });

                        // also trigger the peer add handshake in case the peer was not already added to the olm and we need to hole punch
                        // if it has already been added this will be a no-op
                        await initPeerAddHandshake(
                            // this will kick off the add peer process for the client
                            client.clients.clientId,
                            {
                                siteId,
                                exitNode: {
                                    publicKey: exitNode.publicKey,
                                    endpoint: exitNode.endpoint
                                }
                            }
                        );
                    }

                    return {
                        publicKey: client.clients.pubKey!,
                        allowedIps: [
                            `${client.clients.subnet.split("/")[0]}/32`
                        ], // we want to only allow from that client
                        endpoint: client.clientSitesAssociationsCache.isRelayed
                            ? ""
                            : client.clientSitesAssociationsCache.endpoint! // if its relayed it should be localhost
                    };
                })
        );
    }

    // Filter out any null values from peers that didn't have an olm
    const validPeers = peers.filter((peer) => peer !== null);

    // Get all enabled site resources for this site
    const allSiteResources = await db
        .select()
        .from(siteResources)
        .where(eq(siteResources.siteId, siteId));

    const targetsToSend: SubnetProxyTargetV2[] = [];

    for (const resource of allSiteResources) {
        // Get clients associated with this specific resource
        const resourceClients = await db
            .select({
                clientId: clients.clientId,
                pubKey: clients.pubKey,
                subnet: clients.subnet
            })
            .from(clients)
            .innerJoin(
                clientSiteResourcesAssociationsCache,
                eq(
                    clients.clientId,
                    clientSiteResourcesAssociationsCache.clientId
                )
            )
            .where(
                eq(
                    clientSiteResourcesAssociationsCache.siteResourceId,
                    resource.siteResourceId
                )
            );

        const resourceTarget = generateSubnetProxyTargetV2(
            resource,
            resourceClients
        );

        if (resourceTarget) {
            targetsToSend.push(resourceTarget);
        }
    }

    return {
        peers: validPeers,
        targets: targetsToSend
    };
}

export async function buildTargetConfigurationForNewtClient(siteId: number) {
    // Get all enabled targets with their resource protocol information
    const allTargets = await db
        .select({
            resourceId: targets.resourceId,
            targetId: targets.targetId,
            ip: targets.ip,
            method: targets.method,
            port: targets.port,
            internalPort: targets.internalPort,
            enabled: targets.enabled,
            protocol: resources.protocol,
            hcEnabled: targetHealthCheck.hcEnabled,
            hcPath: targetHealthCheck.hcPath,
            hcScheme: targetHealthCheck.hcScheme,
            hcMode: targetHealthCheck.hcMode,
            hcHostname: targetHealthCheck.hcHostname,
            hcPort: targetHealthCheck.hcPort,
            hcInterval: targetHealthCheck.hcInterval,
            hcUnhealthyInterval: targetHealthCheck.hcUnhealthyInterval,
            hcTimeout: targetHealthCheck.hcTimeout,
            hcHeaders: targetHealthCheck.hcHeaders,
            hcMethod: targetHealthCheck.hcMethod,
            hcTlsServerName: targetHealthCheck.hcTlsServerName,
            hcStatus: targetHealthCheck.hcStatus
        })
        .from(targets)
        .innerJoin(resources, eq(targets.resourceId, resources.resourceId))
        .leftJoin(
            targetHealthCheck,
            eq(targets.targetId, targetHealthCheck.targetId)
        )
        .where(
            and(
                eq(targets.siteId, siteId),
                eq(targets.enabled, true),
                eq(resources.enabled, true)
            )
        );

    const { tcpTargets, udpTargets } = allTargets.reduce(
        (acc, target) => {
            // Filter out invalid targets
            if (!target.internalPort || !target.ip || !target.port) {
                return acc;
            }

            // Format target into string (handles IPv6 bracketing)
            const formattedTarget = `${target.internalPort}:${formatEndpoint(target.ip, target.port)}`;

            // Add to the appropriate protocol array
            if (target.protocol === "tcp") {
                acc.tcpTargets.push(formattedTarget);
            } else {
                acc.udpTargets.push(formattedTarget);
            }

            return acc;
        },
        { tcpTargets: [] as string[], udpTargets: [] as string[] }
    );

    const healthCheckTargets = allTargets.map((target) => {
        // make sure the stuff is defined
        if (
            !target.hcPath ||
            !target.hcHostname ||
            !target.hcPort ||
            !target.hcInterval ||
            !target.hcMethod
        ) {
            // logger.debug(
            //     `Skipping adding target health check ${target.targetId} due to missing health check fields`
            // );
            return null; // Skip targets with missing health check fields
        }

        // parse headers
        const hcHeadersParse = target.hcHeaders
            ? JSON.parse(target.hcHeaders)
            : null;
        const hcHeadersSend: { [key: string]: string } = {};
        if (hcHeadersParse) {
            hcHeadersParse.forEach(
                (header: { name: string; value: string }) => {
                    hcHeadersSend[header.name] = header.value;
                }
            );
        }

        return {
            id: target.targetId,
            hcEnabled: target.hcEnabled,
            hcPath: target.hcPath,
            hcScheme: target.hcScheme,
            hcMode: target.hcMode,
            hcHostname: target.hcHostname,
            hcPort: target.hcPort,
            hcInterval: target.hcInterval, // in seconds
            hcUnhealthyInterval: target.hcUnhealthyInterval, // in seconds
            hcTimeout: target.hcTimeout, // in seconds
            hcHeaders: hcHeadersSend,
            hcMethod: target.hcMethod,
            hcTlsServerName: target.hcTlsServerName,
            hcStatus: target.hcStatus
        };
    });

    // Filter out any null values from health check targets
    const validHealthCheckTargets = healthCheckTargets.filter(
        (target) => target !== null
    );

    return {
        validHealthCheckTargets,
        tcpTargets,
        udpTargets
    };
}
