import {
    clients,
    clientSiteResourcesAssociationsCache,
    clientSitesAssociationsCache,
    db,
    ExitNode,
    networks,
    remoteExitNodeResources,
    resources,
    Site,
    siteNetworks,
    siteResources,
    targetHealthCheck,
    targets
} from "@server/db";
import logger from "@server/logger";
import { initPeerAddHandshake, updatePeer } from "../olm/peers";
import { eq, and, inArray } from "drizzle-orm";
import config from "@server/lib/config";
import { decrypt } from "@server/lib/crypto";
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
                        logger.debug(
                            `Client ${client.clients.clientId} has no public key, skipping`
                        );
                        return false;
                    }
                    if (!client.clients.subnet) {
                        logger.debug(
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

                    if (!client.clientSitesAssociationsCache.isJitMode) {
                        // if we are adding sites through jit then dont add the site to the olm
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

    // Get all enabled site resources for this site by joining through siteNetworks and networks
    const allSiteResources = await db
        .select()
        .from(siteResources)
        .innerJoin(networks, eq(siteResources.networkId, networks.networkId))
        .innerJoin(siteNetworks, eq(networks.networkId, siteNetworks.networkId))
        .where(eq(siteNetworks.siteId, siteId))
        .then((rows) => rows.map((r) => r.siteResources));

    const targetsToSend: SubnetProxyTargetV2[] = [];

    if (allSiteResources.length === 0) {
        return {
            peers: validPeers,
            targets: targetsToSend
        };
    }

    // Batch fetch all client associations for every site resource in one query
    // to avoid an N+1 lookup that would issue thousands of queries when a site
    // has many resources.
    const siteResourceIds = allSiteResources.map((r) => r.siteResourceId);

    const resourceClientRows = await db
        .select({
            siteResourceId: clientSiteResourcesAssociationsCache.siteResourceId,
            clientId: clients.clientId,
            pubKey: clients.pubKey,
            subnet: clients.subnet
        })
        .from(clients)
        .innerJoin(
            clientSiteResourcesAssociationsCache,
            eq(clients.clientId, clientSiteResourcesAssociationsCache.clientId)
        )
        .where(
            inArray(
                clientSiteResourcesAssociationsCache.siteResourceId,
                siteResourceIds
            )
        );

    const clientsByResourceId = new Map<
        number,
        { clientId: number; pubKey: string | null; subnet: string | null }[]
    >();
    for (const row of resourceClientRows) {
        let list = clientsByResourceId.get(row.siteResourceId);
        if (!list) {
            list = [];
            clientsByResourceId.set(row.siteResourceId, list);
        }
        list.push({
            clientId: row.clientId,
            pubKey: row.pubKey,
            subnet: row.subnet
        });
    }

    const resourceTargetsArr = await Promise.all(
        allSiteResources.map((resource) =>
            generateSubnetProxyTargetV2(
                resource,
                clientsByResourceId.get(resource.siteResourceId) ?? []
            )
        )
    );

    for (const resourceTargets of resourceTargetsArr) {
        if (resourceTargets) {
            targetsToSend.push(...resourceTargets);
        }
    }

    return {
        peers: validPeers,
        targets: targetsToSend
    };
}

export async function buildTargetConfigurationForNewtClient(
    siteId: number,
    version?: string | null,
    remoteExitNodeId?: string
) {
    // Get all enabled targets with their resource mode information
    const allTargets = await db
        .select({
            resourceId: targets.resourceId,
            targetId: targets.targetId,
            ip: targets.ip,
            method: targets.method,
            port: targets.port,
            internalPort: targets.internalPort,
            enabled: targets.enabled,
            mode: resources.mode
        })
        .from(targets)
        .innerJoin(resources, eq(targets.resourceId, resources.resourceId))
        .where(
            and(
                eq(targets.siteId, siteId),
                eq(targets.enabled, true),
                inArray(targets.mode, ["http", "udp", "tcp"])
            )
        );

    const allHealthChecks = await db
        .select({
            targetHealthCheckId: targetHealthCheck.targetHealthCheckId,
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
            hcFollowRedirects: targetHealthCheck.hcFollowRedirects,
            hcMethod: targetHealthCheck.hcMethod,
            hcTlsServerName: targetHealthCheck.hcTlsServerName,
            hcStatus: targetHealthCheck.hcStatus,
            hcHealthyThreshold: targetHealthCheck.hcHealthyThreshold,
            hcUnhealthyThreshold: targetHealthCheck.hcUnhealthyThreshold
        })
        .from(targetHealthCheck)
        .where(eq(targetHealthCheck.siteId, siteId));

    // Get all enabled targets with their resource mode information
    const allBrowserGatewayTargets = await db
        .select({
            resourceId: targets.resourceId,
            targetId: targets.targetId,
            ip: targets.ip,
            method: targets.method,
            port: targets.port,
            enabled: targets.enabled,
            mode: resources.mode,
            authToken: targets.authToken
        })
        .from(targets)
        .innerJoin(resources, eq(targets.resourceId, resources.resourceId))
        .where(
            and(
                eq(targets.siteId, siteId),
                eq(targets.enabled, true),
                inArray(targets.mode, ["ssh", "rdp", "vnc"])
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
            if (target.mode === "udp") {
                acc.udpTargets.push(formattedTarget);
            } else {
                // all other modes are tcp
                acc.tcpTargets.push(formattedTarget);
            }

            return acc;
        },
        { tcpTargets: [] as string[], udpTargets: [] as string[] }
    );

    const healthCheckTargets = allHealthChecks.map((target) => {
        // make sure the stuff is defined
        const isTCP = target.hcMode?.toLowerCase() === "tcp";
        if (!target.hcHostname || !target.hcPort || !target.hcInterval) {
            return null;
        }
        if (!isTCP && (!target.hcPath || !target.hcMethod)) {
            return null;
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
            id: target.targetHealthCheckId,
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
            hcFollowRedirects: target.hcFollowRedirects,
            hcMethod: target.hcMethod,
            hcTlsServerName: target.hcTlsServerName,
            hcStatus: target.hcStatus,
            hcHealthyThreshold: target.hcHealthyThreshold,
            hcUnhealthyThreshold: target.hcUnhealthyThreshold
        };
    });

    // Filter out any null values from health check targets
    const validHealthCheckTargets = healthCheckTargets.filter(
        (target) => target !== null
    );

    const serverSecret = config.getRawConfig().server.secret!;
    const browserGatewayTargets = allBrowserGatewayTargets.map((t) => {
        if (!t.ip || !t.port || !t.authToken) {
            return null;
        }
        const decryptAuthToken = decrypt(t.authToken, serverSecret);
        return {
            id: t.targetId,
            type: t.mode,
            destination: t.ip,
            destinationPort: t.port,
            authToken: decryptAuthToken
        };
    });

    let remoteExitNodeSubnets: string[] = [];
    if (remoteExitNodeId) {
        const remoteNodeResources = await db
            .select()
            .from(remoteExitNodeResources)
            .where(
                eq(remoteExitNodeResources.remoteExitNodeId, remoteExitNodeId)
            );

        // filter through these and provide the subnets
        remoteExitNodeSubnets = remoteNodeResources.map((r) => r.destination);
    }

    return {
        validHealthCheckTargets,
        tcpTargets,
        udpTargets,
        browserGatewayTargets,
        remoteExitNodeSubnets
    };
}
