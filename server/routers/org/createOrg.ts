import { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { db, primaryDb } from "@server/db";
import { and, count, eq } from "drizzle-orm";
import {
    domains,
    Org,
    orgDomains,
    orgs,
    roleActions,
    roles,
    userOrgRoles,
    userOrgs,
    users,
    actions,
    customers,
    subscriptions
} from "@server/db";
import response from "@server/lib/response";
import HttpCode from "@server/types/HttpCode";
import createHttpError from "http-errors";
import logger from "@server/logger";
import config from "@server/lib/config";
import { fromError } from "zod-validation-error";
import { defaultRoleAllowedActions } from "../role";
import { OpenAPITags, registry } from "@server/openApi";
import { isValidCIDR } from "@server/lib/validators";
import { createCustomer } from "#dynamic/lib/billing";
import { usageService } from "@server/lib/billing/usageService";
import { LimitId, limitsService, freeLimitSet } from "@server/lib/billing";
import { build } from "@server/build";
import { calculateUserClientsForOrgs } from "@server/lib/calculateUserClientsForOrgs";
import { doCidrsOverlap } from "@server/lib/ip";
import { generateCA } from "@server/lib/sshCA";
import { encrypt } from "@server/lib/crypto";
import { generateId } from "@server/auth/sessions/app";

const validOrgIdRegex = /^[a-z0-9_]+(-[a-z0-9_]+)*$/;

const createOrgSchema = z.strictObject({
    orgId: z
        .string()
        .min(1, "Organization ID is required")
        .max(32, "Organization ID must be at most 32 characters")
        .refine((val) => validOrgIdRegex.test(val), {
            message:
                "Organization ID must contain only lowercase letters, numbers, underscores, and single hyphens (no leading, trailing, or consecutive hyphens)"
        }),
    name: z.string().min(1).max(255),
    subnet: z
        // .union([z.cidrv4(), z.cidrv6()])
        .union([z.cidrv4()]) // for now lets just do ipv4 until we verify ipv6 works everywhere
        .refine((val) => isValidCIDR(val), {
            message: "Invalid subnet CIDR"
        }),
    utilitySubnet: z
        .union([z.cidrv4()]) // for now lets just do ipv4 until we verify ipv6 works everywhere
        .refine((val) => isValidCIDR(val), {
            message: "Invalid utility subnet CIDR"
        })
});

registry.registerPath({
    method: "put",
    path: "/org",
    description: "Create a new organization",
    tags: [OpenAPITags.Org],
    request: {
        body: {
            content: {
                "application/json": {
                    schema: createOrgSchema
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

export async function createOrg(
    req: Request,
    res: Response,
    next: NextFunction
): Promise<any> {
    try {
        // should this be in a middleware?
        if (config.getRawConfig().flags?.disable_user_create_org) {
            if (req.user && !req.user?.serverAdmin) {
                return next(
                    createHttpError(
                        HttpCode.FORBIDDEN,
                        "Only server admins can create organizations"
                    )
                );
            }
        }

        const parsedBody = createOrgSchema.safeParse(req.body);
        if (!parsedBody.success) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    fromError(parsedBody.error).toString()
                )
            );
        }

        const { orgId, name, subnet, utilitySubnet } = parsedBody.data;

        // TODO: for now we are making all of the orgs the same subnet
        // make sure the subnet is unique
        // const subnetExists = await db
        //     .select()
        //     .from(orgs)
        //     .where(eq(orgs.subnet, subnet))
        //     .limit(1);

        // if (subnetExists.length > 0) {
        //     return next(
        //         createHttpError(
        //             HttpCode.CONFLICT,
        //             `Subnet ${subnet} already exists`
        //         )
        //     );
        // }
        //

        // make sure the orgId is unique
        const orgExists = await db
            .select()
            .from(orgs)
            .where(eq(orgs.orgId, orgId))
            .limit(1);

        if (orgExists.length > 0) {
            return next(
                createHttpError(
                    HttpCode.CONFLICT,
                    `Organization with ID ${orgId} already exists`
                )
            );
        }

        if (doCidrsOverlap(subnet, utilitySubnet)) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    `Subnet ${subnet} overlaps with utility subnet ${utilitySubnet}`
                )
            );
        }

        let isFirstOrg: boolean | null = null;
        let billingOrgIdForNewOrg: string | null = null;
        if (build === "saas" && req.user) {
            const ownedOrgs = await db
                .select()
                .from(userOrgs)
                .where(
                    and(
                        eq(userOrgs.userId, req.user.userId),
                        eq(userOrgs.isOwner, true)
                    )
                );
            if (ownedOrgs.length === 0) {
                isFirstOrg = true;
            } else {
                isFirstOrg = false;
                const [billingOrg] = await db
                    .select({ orgId: orgs.orgId })
                    .from(orgs)
                    .innerJoin(userOrgs, eq(orgs.orgId, userOrgs.orgId))
                    .where(
                        and(
                            eq(userOrgs.userId, req.user.userId),
                            eq(userOrgs.isOwner, true),
                            eq(orgs.isBillingOrg, true)
                        )
                    )
                    .limit(1);
                if (billingOrg) {
                    billingOrgIdForNewOrg = billingOrg.orgId;
                }
            }
        }

        if (build == "saas" && billingOrgIdForNewOrg) {
            const usage = await usageService.getUsage(
                billingOrgIdForNewOrg,
                LimitId.ORGANIZATIONS
            );
            if (!usage) {
                return next(
                    createHttpError(
                        HttpCode.NOT_FOUND,
                        "No usage data found for this organization"
                    )
                );
            }
            const rejectOrgs = await usageService.checkLimitSet(
                billingOrgIdForNewOrg,
                LimitId.ORGANIZATIONS,
                {
                    ...usage,
                    instantaneousValue: (usage.instantaneousValue || 0) + 1
                } // We need to add one to know if we are violating the limit
            );
            if (rejectOrgs) {
                return next(
                    createHttpError(
                        HttpCode.FORBIDDEN,
                        "Organization limit exceeded. Please upgrade your plan."
                    )
                );
            }
        }

        let error = "";
        let org: Org | null = null;
        let numOrgs: number | null = null;
        let ownerUserId: string | null = null;

        await db.transaction(async (trx) => {
            const allDomains = await trx
                .select()
                .from(domains)
                .where(eq(domains.configManaged, true));

            const saasBillingFields =
                build === "saas" && req.user && isFirstOrg !== null
                    ? isFirstOrg
                        ? { isBillingOrg: true as const, billingOrgId: orgId } // if this is the first org, it becomes the billing org for itself
                        : {
                              isBillingOrg: false as const,
                              billingOrgId: billingOrgIdForNewOrg
                          }
                    : {};

            const encryptionKey = config.getRawConfig().server.secret;
            let sshCaFields: {
                sshCaPrivateKey?: string;
                sshCaPublicKey?: string;
            } = {};
            if (encryptionKey) {
                const ca = generateCA(`pangolin-ssh-ca-${orgId}`);
                sshCaFields = {
                    sshCaPrivateKey: encrypt(ca.privateKeyPem, encryptionKey),
                    sshCaPublicKey: ca.publicKeyOpenSSH
                };
            }

            const newOrg = await trx
                .insert(orgs)
                .values({
                    orgId,
                    name,
                    subnet,
                    utilitySubnet,
                    createdAt: new Date().toISOString(),
                    ...sshCaFields,
                    ...saasBillingFields
                })
                .returning();

            if (newOrg.length === 0) {
                error = "Failed to create organization";
                trx.rollback();
                return;
            }

            org = newOrg[0];

            // Create admin role within the same transaction
            const [insertedRole] = await trx
                .insert(roles)
                .values({
                    orgId: newOrg[0].orgId,
                    isAdmin: true,
                    name: "Admin",
                    description: "Admin role with the most permissions",
                    sshSudoMode: "full"
                })
                .returning({ roleId: roles.roleId });

            if (!insertedRole || !insertedRole.roleId) {
                error = "Failed to create Admin role";
                trx.rollback();
                return;
            }

            const roleId = insertedRole.roleId;

            // Get all actions and create role actions
            const actionIds = await trx.select().from(actions).execute();

            if (actionIds.length > 0) {
                await trx.insert(roleActions).values(
                    actionIds.map((action) => ({
                        roleId,
                        actionId: action.actionId,
                        orgId: newOrg[0].orgId
                    }))
                );
            }

            if (allDomains.length) {
                await trx.insert(orgDomains).values(
                    allDomains.map((domain) => ({
                        orgId: newOrg[0].orgId,
                        domainId: domain.domainId
                    }))
                );
            }

            if (req.user) {
                await trx.insert(userOrgs).values({
                    userId: req.user!.userId,
                    orgId: newOrg[0].orgId,
                    isOwner: true
                });
                await trx.insert(userOrgRoles).values({
                    userId: req.user!.userId,
                    orgId: newOrg[0].orgId,
                    roleId
                });
                ownerUserId = req.user!.userId;
            } else {
                // if org created by root api key, set the server admin as the owner
                const [serverAdmin] = await trx
                    .select()
                    .from(users)
                    .where(eq(users.serverAdmin, true));

                if (!serverAdmin) {
                    error = "Server admin not found";
                    trx.rollback();
                    return;
                }

                await trx.insert(userOrgs).values({
                    userId: serverAdmin.userId,
                    orgId: newOrg[0].orgId,
                    isOwner: true
                });
                await trx.insert(userOrgRoles).values({
                    userId: serverAdmin.userId,
                    orgId: newOrg[0].orgId,
                    roleId
                });
                ownerUserId = serverAdmin.userId;
            }

            const memberRole = await trx
                .insert(roles)
                .values({
                    name: "Member",
                    description: "Members can only view resources",
                    orgId
                })
                .returning();

            await trx.insert(roleActions).values(
                defaultRoleAllowedActions.map((action) => ({
                    roleId: memberRole[0].roleId,
                    actionId: action,
                    orgId
                }))
            );

            if (billingOrgIdForNewOrg) {
                const [numOrgsResult] = await trx
                    .select({ count: count() })
                    .from(orgs)
                    .where(eq(orgs.billingOrgId, billingOrgIdForNewOrg)); // all the billable orgs including the primary org that is the billing org itself

                numOrgs = numOrgsResult.count;
            } else {
                numOrgs = 1; // we only have one org if there is no billing org found out
            }
        });

        if (ownerUserId) {
            calculateUserClientsForOrgs(ownerUserId).catch((e) => {
                logger.error(
                    `Failed to calculate user clients after creating org ${orgId} for user ${ownerUserId}: ${e}`
                );
            });
        }

        if (!org) {
            return next(
                createHttpError(
                    HttpCode.INTERNAL_SERVER_ERROR,
                    "Failed to create org"
                )
            );
        }

        if (error) {
            return next(createHttpError(HttpCode.INTERNAL_SERVER_ERROR, error));
        }

        if (build === "saas" && isFirstOrg === true) {
            await limitsService.applyLimitSetToOrg(orgId, freeLimitSet);
            const customerId = await createCustomer(orgId, req.user?.email);
            if (customerId) {
                await usageService.updateCount(
                    orgId,
                    LimitId.USERS,
                    1,
                    customerId
                ); // Only 1 because we are creating the org
            }
        }

        if (numOrgs) {
            usageService.updateCount(
                billingOrgIdForNewOrg || orgId,
                LimitId.ORGANIZATIONS,
                numOrgs
            );
        }

        return response(res, {
            data: org,
            success: true,
            error: false,
            message: "Organization created successfully",
            status: HttpCode.CREATED
        });
    } catch (error) {
        logger.error(error);
        return next(
            createHttpError(HttpCode.INTERNAL_SERVER_ERROR, "An error occurred")
        );
    }
}
