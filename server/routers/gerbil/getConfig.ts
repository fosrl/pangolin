import { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { sites, exitNodes, ExitNode, clients } from "@server/db";
import { db } from "@server/db";
import { eq, isNotNull, and } from "drizzle-orm";
import HttpCode from "@server/types/HttpCode";
import createHttpError from "http-errors";
import logger from "@server/logger";
import config from "@server/lib/config";
import { fromError } from "zod-validation-error";
import { getAllowedIps } from "../target/helpers";
import { createExitNode } from "#dynamic/routers/gerbil/createExitNode";

// Define Zod schema for request validation
const getConfigSchema = z.object({
    publicKey: z.string(),
    reachableAt: z.string().optional()
});

export type GetConfigResponse = {
    listenPort: number;
    ipAddress: string;
    peers: {
        publicKey: string | null;
        allowedIps: string[];
    }[];
};

export async function getConfig(
    req: Request,
    res: Response,
    next: NextFunction
): Promise<any> {
    try {
        // Validate request parameters
        const parsedParams = getConfigSchema.safeParse(req.body);
        if (!parsedParams.success) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    fromError(parsedParams.error).toString()
                )
            );
        }

        const { publicKey, reachableAt } = parsedParams.data;

        if (!publicKey) {
            return next(
                createHttpError(HttpCode.BAD_REQUEST, "publicKey is required")
            );
        }

        // clean up the public key - keep only valid base64 characters (A-Z, a-z, 0-9, +, /, =)
        const cleanedPublicKey = publicKey.replace(/[^A-Za-z0-9+/=]/g, "");

        const exitNode = await createExitNode(cleanedPublicKey, reachableAt);

        if (!exitNode) {
            return next(
                createHttpError(
                    HttpCode.INTERNAL_SERVER_ERROR,
                    "Failed to create exit node"
                )
            );
        }

        const configResponse = await generateGerbilConfig(exitNode);

        logger.debug("Sending config: ", configResponse);

        return res.status(HttpCode.OK).send(configResponse);
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

export async function generateGerbilConfig(exitNode: ExitNode) {
    const sitesRes = await db
        .select()
        .from(sites)
        .where(
            and(
                eq(sites.exitNodeId, exitNode.exitNodeId),
                isNotNull(sites.pubKey),
                isNotNull(sites.exitNodeSubnet)
            )
        );

    const clientsRes = await db
        .select()
        .from(clients)
        .where(
            and(
                eq(clients.exitNodeId, exitNode.exitNodeId),
                isNotNull(clients.pubKey),
                isNotNull(clients.exitNodeSubnet)
            )
        );

    let peers: {
        publicKey: string | null;
        allowedIps: string[];
    }[] = [];

    const sitePeers = await Promise.all(
        sitesRes.map(async (site) => {
            if (site.type === "wireguard") {
                return {
                    publicKey: site.pubKey,
                    allowedIps: await getAllowedIps(site.siteId)
                };
            } else if (site.type === "newt") {
                return {
                    publicKey: site.pubKey,
                    allowedIps: [site.exitNodeSubnet!]
                };
            }
            return {
                publicKey: null,
                allowedIps: []
            };
        })
    );

    const clientPeers = clientsRes.map((client) => {
        return {
            publicKey: client.pubKey,
            allowedIps: [client.exitNodeSubnet!]
        };
    });

    peers = [...sitePeers, ...clientPeers];

    const configResponse: GetConfigResponse = {
        listenPort: exitNode.listenPort || 51820,
        ipAddress: exitNode.address,
        peers
    };

    return configResponse;
}
