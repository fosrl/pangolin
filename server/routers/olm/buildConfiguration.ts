import {
    Client,
    clientSiteResourcesAssociationsCache,
    clientSitesAssociationsCache,
    db,
    networks,
    newts,
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
import { and, eq } from "drizzle-orm";
import { addPeersBatch, deletePeersBatch } from "../newt/peers";

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
        localEndpoints?: string[];
        publicKey?: string;
        serverIP?: string | null;
        serverPort?: number | null;
        remoteSubnets?: string[];
        aliases: Alias[];
    }[] = [];

    let exitNodeAliases: string[] = [];

    // Get all sites data
    const sitesDataQuery = db
        .select()
        .from(sites)
        .innerJoin(
            clientSitesAssociationsCache,
            eq(sites.siteId, clientSitesAssociationsCache.siteId)
        )
        .where(eq(clientSitesAssociationsCache.clientId, client.clientId));

    // Batch-fetch the newt for every site so peer updates can be sent as one
    // batch instead of looking up the newt per site. Not needed in JIT mode
    // because no peers are pushed to the sites there.
    const newtRowsQuery = jitMode
        ? Promise.resolve([])
        : db
              .select({ siteId: newts.siteId, newtId: newts.newtId })
              .from(newts)
              .innerJoin(
                  clientSitesAssociationsCache,
                  eq(newts.siteId, clientSitesAssociationsCache.siteId)
              )
              .where(
                  eq(clientSitesAssociationsCache.clientId, client.clientId)
              );

    // Batch-fetch every site resource this client has access to across ALL sites
    // in a single query, then group by siteId in memory. This avoids issuing one
    // query per site (which would be N round-trips for N sites).
    const allClientSiteResourcesQuery = db
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
        .leftJoin(networks, eq(siteResources.networkId, networks.networkId))
        .leftJoin(siteNetworks, eq(networks.networkId, siteNetworks.networkId))
        .where(
            and(
                eq(
                    clientSiteResourcesAssociationsCache.clientId,
                    client.clientId
                ),
                eq(siteResources.enabled, true)
            )
        );

    const [sitesData, newtRows, allClientSiteResources] = await Promise.all([
        sitesDataQuery,
        newtRowsQuery,
        allClientSiteResourcesQuery
    ]);

    const newtIdBySiteId = new Map<number, string>();
    for (const row of newtRows) {
        if (row.siteId != null && !newtIdBySiteId.has(row.siteId)) {
            newtIdBySiteId.set(row.siteId, row.newtId);
        }
    }

    const siteResourcesBySiteId = new Map<number, SiteResource[]>();
    const siteResourcesForExitNode = [];
    for (const row of allClientSiteResources) {
        if (row.siteResource.requiresExitNodeConnection) {
            siteResourcesForExitNode.push(row.siteResource);
        }
        if (!row.siteId) {
            // because we are doing a leftJoin above to get the inference resources without a network / sites
            continue;
        }
        const arr = siteResourcesBySiteId.get(row.siteId);
        if (arr) {
            arr.push(row.siteResource);
        } else {
            siteResourcesBySiteId.set(row.siteId, [row.siteResource]);
        }
    }

    exitNodeAliases = siteResourcesForExitNode
        .map((sr) => sr.fullDomain || sr.alias) // take either in case we introduce different resource types that don't have a fullDomain
        .filter((a) => a != null);

    if (sitesData.length == 0) {
        return {
            siteConfigurations,
            exitNodeAliases
        };
    }

    const peersToDelete: Parameters<typeof deletePeersBatch>[0] = [];
    const peersToAdd: Parameters<typeof addPeersBatch>[0] = [];

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

        const newtId = newtIdBySiteId.get(site.siteId);
        if (!newtId) {
            logger.warn(
                `Newt not found for site ${site.siteId}, skipping peer updates`
            );
        }

        // If public key changed, delete old peer from this site
        if (newtId && client.pubKey && client.pubKey != publicKey) {
            logger.debug(
                `Public key mismatch. Deleting old peer from site ${site.siteId}...`
            );
            peersToDelete.push({
                siteId: site.siteId,
                publicKey: client.pubKey,
                newtId
            });
        }

        if (!site.exitNodeSubnet) {
            logger.debug(`Site ${site.siteId} has no subnet, skipping`);
            continue;
        }

        // Add the peer to the exit node for this site. The endpoint comes from
        // the already-joined association row above, so no extra query needed.
        if (association.endpoint && publicKey) {
            if (newtId) {
                logger.debug(
                    `Adding peer ${publicKey} to site ${site.siteId} with endpoint ${association.endpoint}`
                );
                peersToAdd.push({
                    siteId: site.siteId,
                    newtId,
                    peer: {
                        publicKey: publicKey,
                        allowedIps: [`${client.subnet.split("/")[0]}/32`], // we want to only allow from that client
                        endpoint: relay ? "" : association.endpoint
                    }
                });
            }
        } else {
            logger.warn(
                `Client ${client.clientId} has no endpoint, skipping peer addition`
            );
        }

        // Add site configuration to the array
        siteConfigurations.push({
            siteId: site.siteId,
            name: site.name,
            endpoint: site.endpoint,
            localEndpoints: site.localEndpoints
                ? JSON.parse(site.localEndpoints)
                : undefined,
            publicKey: site.publicKey,
            serverIP: site.address,
            serverPort: site.listenPort,
            remoteSubnets: generateRemoteSubnets(allSiteResources), // we dont add the gateway resources here
            aliases: generateAliasConfig(allSiteResources)
        });
    }

    // Send the peer removals and additions to the newts as one batch each
    // without blocking the response on them. Removals go first so the old key
    // is gone before the new one is added.
    if (peersToDelete.length > 0 || peersToAdd.length > 0) {
        (async () => {
            await deletePeersBatch(peersToDelete);
            await addPeersBatch(peersToAdd);
        })().catch((err) => {
            logger.error("Error processing peer operations: ", err);
        });
    }

    return {
        siteConfigurations,
        exitNodeAliases
    };
}
