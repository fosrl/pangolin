import { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { db, primaryDb } from "@server/db";
import {
    roles,
    Client,
    clients,
    roleClients,
    userClients,
    olms,
    orgs,
    sites
} from "@server/db";
import response from "@server/lib/response";
import HttpCode from "@server/types/HttpCode";
import createHttpError from "http-errors";
import logger from "@server/logger";
import { eq, and } from "drizzle-orm";
import { fromError } from "zod-validation-error";
import { isValidIP } from "@server/lib/validators";
import { isIpInCidr } from "@server/lib/ip";
import { listExitNodes } from "#dynamic/lib/exitNodes";
import { OpenAPITags, registry } from "@server/openApi";
import {
    rebuildClientAssociationsFromClient,
    isOrgRebuildRateLimited
} from "@server/lib/rebuildClientAssociations";
import { getUniqueClientName } from "@server/db/names";

const paramsSchema = z
    .object({
        orgId: z.string(),
        userId: z.string()
    })
    .strict();

const bodySchema = z
    .object({
        name: z.string().min(1).max(255),
        olmId: z.string(),
        subnet: z.string(),
        type: z.enum(["olm"])
    })
    .strict();

export type CreateClientAndOlmBody = z.infer<typeof bodySchema>;

export type CreateClientAndOlmResponse = Client;

registry.registerPath({
    method: "put",
    path: "/org/{orgId}/user/{userId}/client",
    description:
        "Create a new client for a user and associate it with an existing olm.",
    tags: [OpenAPITags.Client],
    request: {
        params: paramsSchema,
        body: {
            content: {
                "application/json": {
                    schema: bodySchema
                }
            }
        }
    },
    responses: {
        200: {
            description: "Successful response",
            content: {
                "application/json": {
                    schema: z.object({
                        data: z.record(z.string(), z.any()).nullable(),
                        success: z.boolean(),
                        error: z.boolean(),
                        message: z.string(),
                        status: z.number()
                    })
                }
            }
        }
    }
});

export async function createUserClient(
    req: Request,
    res: Response,
    next: NextFunction
): Promise<any> {
    try {
        const parsedBody = bodySchema.safeParse(req.body);
        if (!parsedBody.success) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    fromError(parsedBody.error).toString()
                )
            );
        }

        const { name, type, olmId, subnet } = parsedBody.data;

        const parsedParams = paramsSchema.safeParse(req.params);
        if (!parsedParams.success) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    fromError(parsedParams.error).toString()
                )
            );
        }

        const { orgId, userId } = parsedParams.data;

        if (!isValidIP(subnet)) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    "Invalid subnet format. Please provide a valid CIDR notation."
                )
            );
        }

        const [org] = await db.select().from(orgs).where(eq(orgs.orgId, orgId));

        if (!org) {
            return next(
                createHttpError(
                    HttpCode.NOT_FOUND,
                    `Organization with ID ${orgId} not found`
                )
            );
        }

        if (!org.subnet) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    `Organization with ID ${orgId} has no subnet defined`
                )
            );
        }

        if (!isIpInCidr(subnet, org.subnet)) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    "IP is not in the CIDR range of the subnet."
                )
            );
        }

        if (await isOrgRebuildRateLimited(orgId)) {
            return next(
                createHttpError(
                    HttpCode.TOO_MANY_REQUESTS,
                    "Too many concurrent rebuild operations for this organization. Please retry after a moment."
                )
            );
        }

        const updatedSubnet = `${subnet}/${org.subnet.split("/")[1]}`; // we want the block size of the whole org

        // make sure the subnet is unique
        const subnetExistsClients = await db
            .select()
            .from(clients)
            .where(
                and(eq(clients.subnet, updatedSubnet), eq(clients.orgId, orgId))
            )
            .limit(1);

        if (subnetExistsClients.length > 0) {
            return next(
                createHttpError(
                    HttpCode.CONFLICT,
                    `Subnet ${updatedSubnet} already exists in clients`
                )
            );
        }

        const subnetExistsSites = await db
            .select()
            .from(sites)
            .where(
                and(eq(sites.address, updatedSubnet), eq(sites.orgId, orgId))
            )
            .limit(1);

        if (subnetExistsSites.length > 0) {
            return next(
                createHttpError(
                    HttpCode.CONFLICT,
                    `Subnet ${updatedSubnet} already exists in sites`
                )
            );
        }

        // check if the olmId already exists
        const [existingOlm] = await db
            .select()
            .from(olms)
            .where(eq(olms.olmId, olmId))
            .limit(1);

        if (!existingOlm) {
            return next(
                createHttpError(
                    HttpCode.NOT_FOUND,
                    `OLM with ID ${olmId} does not exist`
                )
            );
        }

        if (existingOlm.userId !== userId) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    `OLM with ID ${olmId} does not belong to user with ID ${userId}`
                )
            );
        }

        let newClient: Client | null = null;
        await db.transaction(async (trx) => {
            // TODO: more intelligent way to pick the exit node
            const exitNodesList = await listExitNodes(orgId);
            const randomExitNode =
                exitNodesList[Math.floor(Math.random() * exitNodesList.length)];

            const [adminRole] = await trx
                .select()
                .from(roles)
                .where(and(eq(roles.isAdmin, true), eq(roles.orgId, orgId)))
                .limit(1);

            if (!adminRole) {
                return next(
                    createHttpError(HttpCode.NOT_FOUND, `Admin role not found`)
                );
            }

            const niceId = await getUniqueClientName(orgId);

            [newClient] = await trx
                .insert(clients)
                .values({
                    exitNodeId: randomExitNode.exitNodeId,
                    orgId,
                    niceId,
                    name,
                    subnet: updatedSubnet,
                    type,
                    olmId, // this is to lock it to a specific olm even if the olm moves across clients
                    userId
                })
                .returning();

            await trx.insert(roleClients).values({
                roleId: adminRole.roleId,
                clientId: newClient.clientId
            });

            trx.insert(userClients).values({
                userId,
                clientId: newClient.clientId
            });
        });

        if (newClient) {
            rebuildClientAssociationsFromClient(newClient).catch((e) => {
                logger.error(
                    `Failed to rebuild client associations after creating user client: ${e}`
                );
            });
        }

        return response<CreateClientAndOlmResponse>(res, {
            data: newClient,
            success: true,
            error: false,
            message: "Site created successfully",
            status: HttpCode.CREATED
        });
    } catch (error) {
        logger.error(error);
        return next(
            createHttpError(HttpCode.INTERNAL_SERVER_ERROR, "An error occurred")
        );
    }
}
