import {
    Client,
    clientSiteResourcesAssociationsCache,
    clientSitesAssociationsCache,
    db,
    exitNodes,
    networks,
    SiteResource,
    siteNetworks,
    siteResources,
    sites
} from "@server/db";
import {
    Alias,
    generateAliasConfig,
    generateRemoteSubnets
} from "@server/lib/ip";
import logger from "@server/logger";
import { eq, inArray } from "drizzle-orm";
import { addPeer, deletePeer } from "../newt/peers";
import config from "@server/lib/config";

export async function buildSiteConfigurationForOlmClient(
    client: Client,
    publicKey: string | null,
    relay: boolean,
    jitMode: boolean = false
) {
    const siteConfigurations: {
        siteId: number;
        name?: string;
        endpoint?: string;
        publicKey?: string;
        serverIP?: string | null;
        serverPort?: number | null;
        remoteSubnets?: string[];
        aliases: Alias[];
    }[] = [];

    // Get all sites data
    const sitesData = await db
        .select()
        .from(sites)
        .innerJoin(
            clientSitesAssociationsCache,
            eq(sites.siteId, clientSitesAssociationsCache.siteId)
        )
        .where(eq(clientSitesAssociationsCache.clientId, client.clientId));

    if (sitesData.length === 0) {
        return siteConfigurations;
    }

    // Batch-fetch every site resource this client has access to across ALL sites
    // in a single query, then group by siteId in memory. This avoids issuing one
    // query per site (which would be N round-trips for N sites).
    const allClientSiteResources = await db
        .select({
            siteResource: siteResources,
            siteId: siteNetworks.siteId
        })
        .from(siteResources)
        .innerJoin(
            clientSiteResourcesAssociationsCache,
            eq(
                siteResources.siteResourceId,
                clientSiteResourcesAssociationsCache.siteResourceId
            )
        )
        .innerJoin(networks, eq(siteResources.networkId, networks.networkId))
        .innerJoin(siteNetworks, eq(networks.networkId, siteNetworks.networkId))
        .where(
            eq(clientSiteResourcesAssociationsCache.clientId, client.clientId)
        );

    const siteResourcesBySiteId = new Map<number, SiteResource[]>();
    for (const row of allClientSiteResources) {
        const arr = siteResourcesBySiteId.get(row.siteId);
        if (arr) {
            arr.push(row.siteResource);
        } else {
            siteResourcesBySiteId.set(row.siteId, [row.siteResource]);
        }
    }

    // Batch-fetch exit nodes for all sites in one query (only needed in relay mode).
    const exitNodesById = new Map<number, typeof exitNodes.$inferSelect>();
    if (!jitMode && relay) {
        const exitNodeIds = Array.from(
            new Set(
                sitesData
                    .map(({ sites: s }) => s.exitNodeId)
                    .filter((id): id is number => id != null)
            )
        );
        if (exitNodeIds.length > 0) {
            const nodes = await db
                .select()
                .from(exitNodes)
                .where(inArray(exitNodes.exitNodeId, exitNodeIds));
            for (const n of nodes) {
                exitNodesById.set(n.exitNodeId, n);
            }
        }
    }

    const clientsStartPort = config.getRawConfig().gerbil.clients_start_port;
    const peerOps: Promise<unknown>[] = [];

    // Process each site
    for (const {
        sites: site,
        clientSitesAssociationsCache: association
    } of sitesData) {
        const allSiteResources = siteResourcesBySiteId.get(site.siteId) ?? [];

        if (jitMode) {
            // Add site configuration to the array
            siteConfigurations.push({
                siteId: site.siteId,
                // remoteSubnets: generateRemoteSubnets(allSiteResources),
                aliases: generateAliasConfig(allSiteResources)
            });
            continue;
        }

        if (!site.exitNodeId) {
            logger.warn(
                `Site ${site.siteId} does not have exit node, skipping`
            );
            continue;
        }

        // Validate endpoint and hole punch status
        if (!site.endpoint) {
            logger.warn(
                `In olm register: site ${site.siteId} has no endpoint, skipping`
            );
            continue;
        }

        if (!site.publicKey || site.publicKey == "") {
            // the site is not ready to accept new peers
            logger.warn(`Site ${site.siteId} has no public key, skipping`);
            continue;
        }

        // if (site.lastHolePunch && now - site.lastHolePunch > 6 && relay) {
        //     logger.warn(
        //         `Site ${site.siteId} last hole punch is too old, skipping`
        //     );
        //     continue;
        // }

        // If public key changed, delete old peer from this site
        if (client.pubKey && client.pubKey != publicKey) {
            logger.info(
                `Public key mismatch. Deleting old peer from site ${site.siteId}...`
            );
            peerOps.push(deletePeer(site.siteId, client.pubKey!));
        }

        if (!site.subnet) {
            logger.debug(`Site ${site.siteId} has no subnet, skipping`);
            continue;
        }

        // Add the peer to the exit node for this site. The endpoint comes from
        // the already-joined association row above, so no extra query needed.
        if (association.endpoint && publicKey) {
            logger.info(
                `Adding peer ${publicKey} to site ${site.siteId} with endpoint ${association.endpoint}`
            );
            peerOps.push(
                addPeer(site.siteId, {
                    publicKey: publicKey,
                    allowedIps: [`${client.subnet.split("/")[0]}/32`], // we want to only allow from that client
                    endpoint: relay ? "" : association.endpoint
                })
            );
        } else {
            logger.warn(
                `Client ${client.clientId} has no endpoint, skipping peer addition`
            );
        }

        let relayEndpoint: string | undefined = undefined;
        if (relay) {
            const exitNode = exitNodesById.get(site.exitNodeId);
            if (!exitNode) {
                logger.warn(`Exit node not found for site ${site.siteId}`);
                continue;
            }
            relayEndpoint = `${exitNode.endpoint}:${clientsStartPort}`;
        }

        // Add site configuration to the array
        siteConfigurations.push({
            siteId: site.siteId,
            name: site.name,
            // relayEndpoint: relayEndpoint, // this can be undefined now if not relayed // lets not do this for now because it would conflict with the hole punch testing
            endpoint: site.endpoint,
            publicKey: site.publicKey,
            serverIP: site.address,
            serverPort: site.listenPort,
            remoteSubnets: generateRemoteSubnets(allSiteResources),
            aliases: generateAliasConfig(allSiteResources)
        });
    }

    // Run all peer add/delete operations concurrently rather than serially per
    // site, so total time is bounded by the slowest call instead of the sum.
    if (peerOps.length > 0) {
        Promise.allSettled(peerOps).catch((err) => {
            logger.error("Error processing peer operations: ", err);
        });
    }

    return siteConfigurations;
}
