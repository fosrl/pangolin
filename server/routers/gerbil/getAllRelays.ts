import { Request, Response, NextFunction } from "express";
import { z } from "zod";
import {
    clients,
    exitNodes,
    newts,
    olms,
    Site,
    sites,
    clientSitesAssociationsCache,
    ExitNode
} from "@server/db";
import { db } from "@server/db";
import { eq, inArray } from "drizzle-orm";
import HttpCode from "@server/types/HttpCode";
import createHttpError from "http-errors";
import logger from "@server/logger";
import { fromError } from "zod-validation-error";

// Define Zod schema for request validation
const getAllRelaysSchema = z.object({
    publicKey: z.string().optional()
});

// Type for peer destination
interface PeerDestination {
    destinationIP: string;
    destinationPort: number;
}

// Updated mappings type to support multiple destinations per endpoint
interface ProxyMapping {
    destinations: PeerDestination[];
}

export async function getAllRelays(
    req: Request,
    res: Response,
    next: NextFunction
): Promise<any> {
    try {
        // Validate request parameters
        const parsedParams = getAllRelaysSchema.safeParse(req.body);
        if (!parsedParams.success) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    fromError(parsedParams.error).toString()
                )
            );
        }

        const { publicKey } = parsedParams.data;

        if (!publicKey) {
            return next(
                createHttpError(HttpCode.BAD_REQUEST, "publicKey is required")
            );
        }

        // Fetch exit node
        const [exitNode] = await db
            .select()
            .from(exitNodes)
            .where(eq(exitNodes.publicKey, publicKey));
        if (!exitNode) {
            return next(
                createHttpError(HttpCode.NOT_FOUND, "Exit node not found")
            );
        }

        const mappings = await generateRelayMappings(exitNode);

        logger.debug(
            `Returning mappings for ${Object.keys(mappings).length} endpoints`
        );
        return res.status(HttpCode.OK).send({ mappings });
    } catch (error) {
        logger.error(error);
        return next(
            createHttpError(
                HttpCode.INTERNAL_SERVER_ERROR,
                "An error occurred..."
            )
        );
    }
}

export async function generateRelayMappings(exitNode: ExitNode) {
    // Fetch sites for this exit node
    const sitesRes = await db
        .select()
        .from(sites)
        .where(eq(sites.exitNodeId, exitNode.exitNodeId));

    if (sitesRes.length === 0) {
        return {};
    }

    // Filter to sites with the required fields up front so the rest of the
    // function can safely treat endpoint/subnet/listenPort as defined.
    const validSites = sitesRes.filter(
        (s) => s.endpoint && s.exitNodeSubnet && s.listenPort
    );

    if (validSites.length === 0) {
        return {};
    }

    const siteIds = validSites.map((s) => s.siteId);
    const orgIds = Array.from(
        new Set(
            validSites
                .map((s) => s.orgId)
                .filter((id): id is NonNullable<typeof id> => id != null)
        )
    );

    // Batch fetch all client-site associations for these sites in one query.
    const clientSitesRes = siteIds.length
        ? await db
              .select()
              .from(clientSitesAssociationsCache)
              .where(inArray(clientSitesAssociationsCache.siteId, siteIds))
        : [];

    // Batch fetch all sites in the relevant orgs in one query (covers
    // site-to-site communication for every site processed below).
    const orgSitesRes = orgIds.length
        ? await db.select().from(sites).where(inArray(sites.orgId, orgIds))
        : [];

    // Index org sites by orgId for O(1) lookup per site.
    const sitesByOrg = new Map<string, typeof orgSitesRes>();
    for (const peer of orgSitesRes) {
        if (
            peer.orgId == null ||
            !peer.endpoint ||
            !peer.exitNodeSubnet ||
            !peer.listenPort
        ) {
            continue;
        }
        let arr = sitesByOrg.get(peer.orgId);
        if (!arr) {
            arr = [];
            sitesByOrg.set(peer.orgId, arr);
        }
        arr.push(peer);
    }

    // Index client-site associations by siteId for O(1) lookup per site.
    const clientSitesBySite = new Map<number, typeof clientSitesRes>();
    for (const cs of clientSitesRes) {
        let arr = clientSitesBySite.get(cs.siteId);
        if (!arr) {
            arr = [];
            clientSitesBySite.set(cs.siteId, arr);
        }
        arr.push(cs);
    }

    // Initialize mappings object for multi-peer support
    const mappings: { [key: string]: ProxyMapping } = {};

    // Track destinations per endpoint to deduplicate in O(1).
    const seen = new Map<string, Set<string>>();

    const addDestination = (endpoint: string, dest: PeerDestination) => {
        let destSet = seen.get(endpoint);
        if (!destSet) {
            destSet = new Set();
            seen.set(endpoint, destSet);
            mappings[endpoint] = { destinations: [] };
        }
        const key = `${dest.destinationIP}:${dest.destinationPort}`;
        if (!destSet.has(key)) {
            destSet.add(key);
            mappings[endpoint].destinations.push(dest);
        }
    };

    // Process each site using the pre-fetched data.
    for (const site of validSites) {
        const siteDestination: PeerDestination = {
            destinationIP: site.exitNodeSubnet!.split("/")[0],
            destinationPort: site.listenPort! || 1 // this satisfies gerbil for now but should be reevaluated
        };

        // Add this site as a destination for each associated client.
        const clientSites = clientSitesBySite.get(site.siteId);
        if (clientSites) {
            for (const clientSite of clientSites) {
                if (!clientSite.endpoint) {
                    continue;
                }
                addDestination(clientSite.endpoint, siteDestination);
            }
        }

        // Site-to-site communication (all sites in the same org).
        if (site.orgId != null) {
            const peers = sitesByOrg.get(site.orgId);
            if (peers) {
                for (const peer of peers) {
                    if (peer.siteId === site.siteId) {
                        continue;
                    }
                    addDestination(site.endpoint!, {
                        destinationIP: peer.exitNodeSubnet!.split("/")[0],
                        destinationPort: peer.listenPort! || 1 // this satisfies gerbil for now but should be reevaluated
                    });
                }
            }
        }
    }

    return mappings;
}
