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
import moment from "moment";
import { hashPassword } from "@server/auth/password";
import { isValidIP } from "@server/lib/validators";
import { isIpInCidr } from "@server/lib/ip";
import { listExitNodes } from "#dynamic/lib/exitNodes";
import { generateId } from "@server/auth/sessions/app";
import { OpenAPITags, registry } from "@server/openApi";
import {
    rebuildClientAssociationsFromClient,
    isOrgRebuildRateLimited
} from "@server/lib/rebuildClientAssociations";
import { getUniqueClientName } from "@server/db/names";
import { build } from "@server/build";
import { LimitId } from "@server/lib/billing";
import { usageService } from "@server/lib/billing/usageService";

const createClientParamsSchema = z.strictObject({
    orgId: z.string()
});

const createClientSchema = z.strictObject({
    name: z.string().min(1).max(255),
    olmId: z.string(),
    secret: z.string(),
    subnet: z.string(),
    type: z.enum(["olm"])
});

export type CreateClientBody = z.infer<typeof createClientSchema>;

export type CreateClientResponse = Client;

registry.registerPath({
    method: "put",
    path: "/org/{orgId}/client",
    description: "Create a new client for an organization.",
    tags: [OpenAPITags.Client],
    request: {
        params: createClientParamsSchema,
        body: {
            content: {
                "application/json": {
                    schema: createClientSchema
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

export async function createClient(
    req: Request,
    res: Response,
    next: NextFunction
): Promise<any> {
    try {
        const parsedBody = createClientSchema.safeParse(req.body);
        if (!parsedBody.success) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    fromError(parsedBody.error).toString()
                )
            );
        }

        const { name, type, olmId, secret, subnet } = parsedBody.data;

        const parsedParams = createClientParamsSchema.safeParse(req.params);
        if (!parsedParams.success) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    fromError(parsedParams.error).toString()
                )
            );
        }

        const { orgId } = parsedParams.data;

        if (
            req.user &&
            (!req.userOrgRoleIds || req.userOrgRoleIds.length === 0)
        ) {
            return next(
                createHttpError(HttpCode.FORBIDDEN, "User does not have a role")
            );
        }

        if (!isValidIP(subnet)) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    "Invalid subnet format. Please provide a valid IP."
                )
            );
        }

        if (build == "saas") {
            const usage = await usageService.getUsage(
                orgId,
                LimitId.MACHINE_CLIENTS
            );
            if (!usage) {
                return next(
                    createHttpError(
                        HttpCode.NOT_FOUND,
                        "No usage data found for this organization"
                    )
                );
            }
            const rejectClient = await usageService.checkLimitSet(
                orgId,

                LimitId.MACHINE_CLIENTS,
                {
                    ...usage,
                    instantaneousValue: (usage.instantaneousValue || 0) + 1
                } // We need to add one to know if we are violating the limit
            );
            if (rejectClient) {
                return next(
                    createHttpError(
                        HttpCode.FORBIDDEN,
                        "Machine client limit exceeded. Please upgrade your plan."
                    )
                );
            }
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

        if (existingOlm) {
            return next(
                createHttpError(
                    HttpCode.CONFLICT,
                    `OLM with ID ${olmId} already exists`
                )
            );
        }

        let newClient: Client | null = null;
        await db.transaction(async (trx) => {
            // TODO: more intelligent way to pick the exit node
            const exitNodesList = await listExitNodes(orgId);
            const randomExitNode =
                exitNodesList[Math.floor(Math.random() * exitNodesList.length)];

            if (!randomExitNode) {
                return next(
                    createHttpError(
                        HttpCode.NOT_FOUND,
                        `No exit nodes available. ${build == "saas" ? "Please contact support." : "You need to install gerbil to use the clients."}`
                    )
                );
            }

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
                    niceId,
                    exitNodeId: randomExitNode.exitNodeId,
                    orgId,
                    name,
                    subnet: updatedSubnet,
                    type,
                    olmId // this is to lock it to a specific olm even if the olm moves across clients
                })
                .returning();

            await trx.insert(roleClients).values({
                roleId: adminRole.roleId,
                clientId: newClient.clientId
            });

            if (req.user && !req.userOrgRoleIds?.includes(adminRole.roleId)) {
                // make sure the user can access the client
                trx.insert(userClients).values({
                    userId: req.user.userId,
                    clientId: newClient.clientId
                });
            }

            let secretToUse = secret;
            if (!secretToUse) {
                secretToUse = generateId(48);
            }

            const secretHash = await hashPassword(secretToUse);

            await trx.insert(olms).values({
                olmId,
                secretHash,
                name,
                clientId: newClient.clientId,
                dateCreated: moment().toISOString()
            });

            await usageService.add(orgId, LimitId.MACHINE_CLIENTS, 1, trx);
        });

        if (newClient) {
            rebuildClientAssociationsFromClient(newClient).catch((e) => {
                logger.error(
                    `Failed to rebuild client associations after creating client: ${e}`
                );
            });
        }

        return response<CreateClientResponse>(res, {
            data: newClient,
            success: true,
            error: false,
            message: "Client created successfully",
            status: HttpCode.CREATED
        });
    } catch (error) {
        logger.error(error);
        return next(
            createHttpError(HttpCode.INTERNAL_SERVER_ERROR, "An error occurred")
        );
    }
}
