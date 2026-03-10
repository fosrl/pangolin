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
import { eq } from "drizzle-orm";
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

    // Initialize mappings object for multi-peer support
    const mappings: { [key: string]: ProxyMapping } = {};

    // Process each site
    for (const site of sitesRes) {
        if (!site.endpoint || !site.subnet || !site.listenPort) {
            continue;
        }

        // Find all clients associated with this site through clientSites
        const clientSitesRes = await db
            .select()
            .from(clientSitesAssociationsCache)
            .where(eq(clientSitesAssociationsCache.siteId, site.siteId));

        for (const clientSite of clientSitesRes) {
            if (!clientSite.endpoint) {
                continue;
            }

            // Add this site as a destination for the client
            if (!mappings[clientSite.endpoint]) {
                mappings[clientSite.endpoint] = { destinations: [] };
            }

            // Add site as a destination for this client
            const destination: PeerDestination = {
                destinationIP: site.subnet.split("/")[0],
                destinationPort: site.listenPort || 1 // this satisfies gerbil for now but should be reevaluated
            };

            // Check if this destination is already in the array to avoid duplicates
            const isDuplicate = mappings[clientSite.endpoint].destinations.some(
                (dest) =>
                    dest.destinationIP === destination.destinationIP &&
                    dest.destinationPort === destination.destinationPort
            );

            if (!isDuplicate) {
                mappings[clientSite.endpoint].destinations.push(destination);
            }
        }

        // Also handle site-to-site communication (all sites in the same org)
        if (site.orgId) {
            const orgSites = await db
                .select()
                .from(sites)
                .where(eq(sites.orgId, site.orgId));

            for (const peer of orgSites) {
                // Skip self
                if (
                    peer.siteId === site.siteId ||
                    !peer.endpoint ||
                    !peer.subnet ||
                    !peer.listenPort
                ) {
                    continue;
                }

                // Add peer site as a destination for this site
                if (!mappings[site.endpoint]) {
                    mappings[site.endpoint] = { destinations: [] };
                }

                const destination: PeerDestination = {
                    destinationIP: peer.subnet.split("/")[0],
                    destinationPort: peer.listenPort || 1 // this satisfies gerbil for now but should be reevaluated
                };

                // Check for duplicates
                const isDuplicate = mappings[site.endpoint].destinations.some(
                    (dest) =>
                        dest.destinationIP === destination.destinationIP &&
                        dest.destinationPort === destination.destinationPort
                );

                if (!isDuplicate) {
                    mappings[site.endpoint].destinations.push(destination);
                }
            }
        }
    }

    return mappings;
}
