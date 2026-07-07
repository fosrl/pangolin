import { Request, Response, NextFunction } from "express";
import { db } from "@server/db";
import { exitNodes, sites } from "@server/db";
import { eq } from "drizzle-orm";
import response from "@server/lib/response";
import HttpCode from "@server/types/HttpCode";
import createHttpError from "http-errors";
import logger from "@server/logger";
import {
    findNextAvailableCidr,
    getNextAvailableClientSubnet
} from "@server/lib/ip";
import { generateId } from "@server/auth/sessions/app";
import config from "@server/lib/config";
import { OpenAPITags, registry } from "@server/openApi";
import { fromError } from "zod-validation-error";
import { z } from "zod";
import { createApiResponseSchema } from "@server/lib/openapi/createApiResponseSchema";
import { listExitNodes } from "#dynamic/lib/exitNodes";

export type PickSiteDefaultsResponse = {
    exitNodeId: number;
    address: string;
    publicKey: string;
    name: string;
    listenPort: number;
    endpoint: string;
    subnet: string; // TODO: make optional?
    newtId: string;
    newtSecret: string;
    clientAddress?: string;
};
const PickSiteDefaultsResponseDataSchema = z.object({
    exitNodeId: z.number(),
    address: z.string(),
    publicKey: z.string(),
    name: z.string(),
    listenPort: z.number(),
    endpoint: z.string(),
    subnet: z.string(),
    newtId: z.string(),
    newtSecret: z.string(),
    clientAddress: z.string().optional()
});


registry.registerPath({
    method: "get",
    path: "/org/{orgId}/pick-site-defaults",
    description:
        "Return pre-requisite data for creating a site, such as the exit node, subnet, Newt credentials, etc.",
    tags: [OpenAPITags.Site],
    request: {
        params: z.object({
            orgId: z.string()
        })
    },
    responses: {
        200: {
            description: "Successful response",
            content: {
                "application/json": {
                    schema: createApiResponseSchema(PickSiteDefaultsResponseDataSchema)
                }
            }
        }
    }
});

const pickSiteDefaultsSchema = z.strictObject({
    orgId: z.string()
});

export async function pickSiteDefaults(
    req: Request,
    res: Response,
    next: NextFunction
): Promise<any> {
    try {
        const parsedParams = pickSiteDefaultsSchema.safeParse(req.params);
        if (!parsedParams.success) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    fromError(parsedParams.error).toString()
                )
            );
        }

        const { orgId } = parsedParams.data;
        // TODO: more intelligent way to pick the exit node

        const exitNodesList = await listExitNodes(orgId);

        const randomExitNode =
            exitNodesList[Math.floor(Math.random() * exitNodesList.length)];

        if (!randomExitNode) {
            return next(
                createHttpError(
                    HttpCode.INTERNAL_SERVER_ERROR,
                    "No available exit node"
                )
            );
        }

        // TODO: this probably can be optimized...
        // list all of the sites on that exit node
        const sitesQuery = await db
            .select({
                subnet: sites.subnet
            })
            .from(sites)
            .where(eq(sites.exitNodeId, randomExitNode.exitNodeId));

        // TODO: we need to lock this subnet for some time so someone else does not take it
        const subnets = sitesQuery
            .map((site) => site.subnet)
            .filter(
                (subnet) =>
                    subnet && /^(\d{1,3}\.){3}\d{1,3}\/\d{1,2}$/.test(subnet)
            )
            .filter((subnet) => subnet !== null);
        // exclude the exit node address by replacing after the / with a site block size
        subnets.push(
            randomExitNode.address.replace(
                /\/\d+$/,
                `/${config.getRawConfig().gerbil.site_block_size}`
            )
        );
        const newSubnet = findNextAvailableCidr(
            subnets,
            config.getRawConfig().gerbil.site_block_size,
            randomExitNode.address
        );
        if (!newSubnet) {
            return next(
                createHttpError(
                    HttpCode.INTERNAL_SERVER_ERROR,
                    "No available subnets"
                )
            );
        }

        const { value: newClientAddress, release: releaseSubnetLock } =
            await getNextAvailableClientSubnet(orgId);
        await releaseSubnetLock(); // release immediately — this endpoint only previews the next available value
        if (!newClientAddress) {
            return next(
                createHttpError(
                    HttpCode.INTERNAL_SERVER_ERROR,
                    "No available address"
                )
            );
        }

        const clientAddress = newClientAddress.split("/")[0];

        const newtId = generateId(15);
        const secret = generateId(48);

        return response<PickSiteDefaultsResponse>(res, {
            data: {
                exitNodeId: randomExitNode.exitNodeId,
                address: randomExitNode.address,
                publicKey: randomExitNode.publicKey,
                name: randomExitNode.name,
                listenPort: randomExitNode.listenPort,
                endpoint: randomExitNode.endpoint,
                // subnet: `${newSubnet.split("/")[0]}/${config.getRawConfig().gerbil.block_size}`, // we want the block size of the whole subnet
                subnet: newSubnet,
                clientAddress: clientAddress,
                newtId,
                newtSecret: secret
            },
            success: true,
            error: false,
            message: "Site defaults chosen successfully",
            status: HttpCode.OK
        });
    } catch (error) {
        logger.error(error);
        return next(
            createHttpError(HttpCode.INTERNAL_SERVER_ERROR, "An error occurred")
        );
    }
}
