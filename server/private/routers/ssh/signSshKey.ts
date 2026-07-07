/*
 * This file is part of a proprietary work.
 *
 * Copyright (c) 2025-2026 Fossorial, Inc.
 * All rights reserved.
 *
 * This file is licensed under the Fossorial Commercial License.
 * You may not use this file except in compliance with the License.
 * Unauthorized use, copying, modification, or distribution is strictly prohibited.
 *
 * This file is not licensed under the AGPLv3.
 */

import { Request, Response, NextFunction } from "express";
import { randomInt } from "crypto";
import { z } from "zod";
import {
    actionAuditLog,
    db,
    logsDb,
    newts,
    roles,
    roleActions,
    rolePolicies,
    roleResources,
    roleSiteResources,
    resources,
    roundTripMessageTracker,
    siteResources,
    siteNetworks,
    targets,
    userOrgs,
    sites,
    Resource,
    SiteResource
} from "@server/db";
import { logAccessAudit } from "#private/lib/logAccessAudit";
import { isLicensedOrSubscribed } from "#private/lib/isLicencedOrSubscribed";
import { tierMatrix } from "@server/lib/billing/tierMatrix";
import response from "@server/lib/response";
import HttpCode from "@server/types/HttpCode";
import createHttpError from "http-errors";
import logger from "@server/logger";
import { fromError } from "zod-validation-error";
import { and, eq, inArray, isNull, or } from "drizzle-orm";
import { canUserAccessResource } from "@server/auth/canUserAccessResource";
import { canUserAccessSiteResource } from "@server/auth/canUserAccessSiteResource";
import { signPublicKey, getOrgCAKeys } from "@server/lib/sshCA";
import config from "@server/lib/config";
import { sendToClient } from "#private/routers/ws";
import { ActionsEnum } from "@server/auth/actions";
import type { SignSshKeyResponse } from "@server/routers/ssh/types";

const paramsSchema = z.strictObject({
    orgId: z.string().nonempty()
});

const bodySchema = z
    .strictObject({
        publicKey: z.string().nonempty(),
        resourceId: z.number().int().positive().optional(),
        resource: z.string().nonempty().optional(), // this is either the nice id or the alias
        username: z.string().nonempty().optional(),
        type: z.enum(["public", "private"]).default("private")
    })
    .refine(
        (data) => {
            const fields = [data.resourceId, data.resource];
            const definedFields = fields.filter((field) => field !== undefined);
            return definedFields.length === 1;
        },
        {
            message:
                "Exactly one of resourceId, niceId, or alias must be provided"
        }
    );

export async function signSshKey(
    req: Request,
    res: Response,
    next: NextFunction
): Promise<any> {
    try {
        const parsedParams = paramsSchema.safeParse(req.params);
        if (!parsedParams.success) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    fromError(parsedParams.error).toString()
                )
            );
        }

        const parsedBody = bodySchema.safeParse(req.body);
        if (!parsedBody.success) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    fromError(parsedBody.error).toString()
                )
            );
        }

        const { orgId } = parsedParams.data;
        const {
            publicKey,
            resourceId,
            type,
            resource: resourceQueryString,
            username
        } = parsedBody.data;
        const userId = req.user?.userId;
        const roleIds = req.userOrgRoleIds ?? [];

        if (!userId) {
            return next(
                createHttpError(HttpCode.UNAUTHORIZED, "User not authenticated")
            );
        }

        if (roleIds.length === 0) {
            return next(
                createHttpError(
                    HttpCode.FORBIDDEN,
                    "User has no role in organization"
                )
            );
        }

        const [userOrg] = await db
            .select()
            .from(userOrgs)
            .where(and(eq(userOrgs.orgId, orgId), eq(userOrgs.userId, userId)))
            .limit(1);

        if (!userOrg) {
            return next(
                createHttpError(
                    HttpCode.FORBIDDEN,
                    "User does not belong to the specified organization"
                )
            );
        }

        const roleActionPermission = await db
            .select({ roleId: roleActions.roleId })
            .from(roleActions)
            .where(
                and(
                    eq(roleActions.actionId, ActionsEnum.signSshKey),
                    inArray(roleActions.roleId, roleIds),
                    eq(roleActions.orgId, orgId)
                )
            )
            .limit(1);

        if (roleActionPermission.length === 0) {
            return next(
                createHttpError(
                    HttpCode.FORBIDDEN,
                    "User does not have permission perform this action"
                )
            );
        }

        const isLicensed = await isLicensedOrSubscribed(
            orgId,
            tierMatrix.advancedPrivateResources
        );
        if (!isLicensed) {
            return next(
                createHttpError(
                    HttpCode.FORBIDDEN,
                    "SSH key signing requires a paid plan"
                )
            );
        }

        // Get and decrypt the org's CA keys
        const caKeys = await getOrgCAKeys(
            orgId,
            config.getRawConfig().server.secret!
        );

        if (!caKeys) {
            return next(
                createHttpError(
                    HttpCode.NOT_FOUND,
                    "SSH CA not configured for this organization"
                )
            );
        }

        let matchingResources: SiteResource[] | Resource[] = [];
        // Verify the resource exists and belongs to the org.
        // Build the where clause dynamically based on which field is provided.
        let whereClause;
        if (resourceId !== undefined) {
            whereClause =
                type === "private"
                    ? eq(siteResources.siteResourceId, resourceId)
                    : eq(resources.resourceId, resourceId);
        } else if (resourceQueryString !== undefined) {
            whereClause =
                type === "private"
                    ? or(
                          eq(siteResources.niceId, resourceQueryString),
                          eq(siteResources.alias, resourceQueryString)
                      )
                    : eq(resources.niceId, resourceQueryString);
        } else {
            // This should never happen due to the schema validation, but TypeScript doesn't know that.
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    "One of resourceId, niceId, or alias must be provided"
                )
            );
        }

        if (type === "private") {
            matchingResources = await db
                .select()
                .from(siteResources)
                .where(and(whereClause, eq(siteResources.orgId, orgId)));
        } else {
            matchingResources = await db
                .select()
                .from(resources)
                .where(and(whereClause, eq(resources.orgId, orgId)));
        }

        if (!matchingResources || matchingResources.length === 0) {
            return next(
                createHttpError(HttpCode.NOT_FOUND, `Resource not found`)
            );
        }

        if (matchingResources.length > 1) {
            // error but this should not happen because the nice id cant contain a dot and the alias has to have a dot and both have to be unique within the org so there should never be multiple matches
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    `Multiple resources found matching the criteria`
                )
            );
        }

        const resource = matchingResources[0];
        const normalizedResourceId =
            type === "private"
                ? (resource as SiteResource).siteResourceId
                : (resource as Resource).resourceId;

        if (resource.orgId !== orgId) {
            return next(
                createHttpError(
                    HttpCode.FORBIDDEN,
                    "Resource does not belong to the specified organization"
                )
            );
        }

        if (resource.mode == "cidr") {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    "SSHing is not supported for CIDR resources"
                )
            );
        }

        // Check if the user has access to the resource
        const hasAccess =
            type === "private"
                ? await canUserAccessSiteResource({
                      userId: userId,
                      resourceId: (resource as SiteResource).siteResourceId,
                      roleIds
                  })
                : await canUserAccessResource({
                      userId: userId,
                      resourceId: (resource as Resource).resourceId,
                      roleIds
                  });

        if (!hasAccess) {
            return next(
                createHttpError(
                    HttpCode.FORBIDDEN,
                    "User does not have access to this resource"
                )
            );
        }

        const siteAgentHostMap = new Map<number, string>();
        let siteIds: number[] = [];

        if (type === "private") {
            const privateResource = resource as SiteResource;
            const sitesFromNetworks = await db
                .select({ siteId: siteNetworks.siteId })
                .from(siteNetworks)
                .where(eq(siteNetworks.networkId, privateResource.networkId!));

            siteIds = sitesFromNetworks.map((site) => site.siteId);
            for (const siteId of siteIds) {
                if (privateResource.destination) {
                    siteAgentHostMap.set(siteId, privateResource.destination);
                }
            }
        } else {
            const publicResource = resource as Resource;
            const targetRows = await db
                .select({
                    siteId: targets.siteId,
                    ip: targets.ip
                })
                .from(targets)
                .where(
                    and(
                        eq(targets.resourceId, publicResource.resourceId),
                        eq(targets.enabled, true),
                        eq(targets.mode, "ssh")
                    )
                );

            if (targetRows.length === 0) {
                return next(
                    createHttpError(
                        HttpCode.NOT_FOUND,
                        "No enabled targets found for the resource"
                    )
                );
            }

            for (const targetRow of targetRows) {
                if (!siteAgentHostMap.has(targetRow.siteId)) {
                    siteAgentHostMap.set(targetRow.siteId, targetRow.ip);
                }
            }

            siteIds = Array.from(siteAgentHostMap.keys());
        }

        let expiresIn: number | undefined;
        let messageIds: number[] = [];
        let cert:
            | {
                  certificate: string;
                  keyId: string;
                  validPrincipals: string[];
                  validAfter: Date;
                  validBefore: Date;
              }
            | undefined;
        // if the pam mode is push then we generate the user's pam username and use that or pull it from the userOrgs table
        // if the mode is passthrough then just use what was provided because the user will log in themselves
        let usernameToUse;
        if (resource.pamMode === "push") {
            if (!userOrg.pamUsername) {
                if (req.user?.email) {
                    // Extract username from email (first part before @)
                    usernameToUse = req.user?.email
                        .split("@")[0]
                        .replace(/[^a-zA-Z0-9_-]/g, "");
                    if (!usernameToUse) {
                        return next(
                            createHttpError(
                                HttpCode.BAD_REQUEST,
                                "Unable to extract username from email"
                            )
                        );
                    }
                } else if (req.user?.username) {
                    usernameToUse = req.user.username;
                    // We need to clean out any spaces or special characters from the username to ensure it's valid for SSH certificates
                    usernameToUse = usernameToUse.replace(
                        /[^a-zA-Z0-9_-]/g,
                        "-"
                    );
                    if (!usernameToUse) {
                        return next(
                            createHttpError(
                                HttpCode.BAD_REQUEST,
                                "Username is not valid for SSH certificate"
                            )
                        );
                    }
                } else {
                    return next(
                        createHttpError(
                            HttpCode.BAD_REQUEST,
                            "User does not have a valid email or username for SSH certificate"
                        )
                    );
                }

                // prefix with p-
                usernameToUse = `p-${usernameToUse}`;

                // check if we have a existing user in this org with the same
                const [existingUserWithSameName] = await db
                    .select()
                    .from(userOrgs)
                    .where(
                        and(
                            eq(userOrgs.orgId, orgId),
                            eq(userOrgs.pamUsername, usernameToUse)
                        )
                    )
                    .limit(1);

                if (existingUserWithSameName) {
                    let foundUniqueUsername = false;
                    for (let attempt = 0; attempt < 20; attempt++) {
                        const randomNum = randomInt(0, 101); // 0 to 100
                        const candidateUsername = `${usernameToUse}${randomNum}`;

                        const [existingUser] = await db
                            .select()
                            .from(userOrgs)
                            .where(
                                and(
                                    eq(userOrgs.orgId, orgId),
                                    eq(userOrgs.pamUsername, candidateUsername)
                                )
                            )
                            .limit(1);

                        if (!existingUser) {
                            usernameToUse = candidateUsername;
                            foundUniqueUsername = true;
                            break;
                        }
                    }

                    if (!foundUniqueUsername) {
                        return next(
                            createHttpError(
                                HttpCode.CONFLICT,
                                "Unable to generate a unique username for SSH certificate"
                            )
                        );
                    }
                }

                await db
                    .update(userOrgs)
                    .set({ pamUsername: usernameToUse })
                    .where(
                        and(
                            eq(userOrgs.orgId, orgId),
                            eq(userOrgs.userId, userId)
                        )
                    );
            } else {
                usernameToUse = userOrg.pamUsername;
            }

            type RoleSshMeta = {
                roleId: number;
                sshSudoCommands: string | null;
                sshUnixGroups: string | null;
                sshCreateHomeDir: boolean | null;
                sshSudoMode: string | null;
            };

            let roleRows: RoleSshMeta[] = [];

            if (type === "private") {
                roleRows = await db
                    .select({
                        roleId: roles.roleId,
                        sshSudoCommands: roles.sshSudoCommands,
                        sshUnixGroups: roles.sshUnixGroups,
                        sshCreateHomeDir: roles.sshCreateHomeDir,
                        sshSudoMode: roles.sshSudoMode
                    })
                    .from(roles)
                    .innerJoin(
                        roleSiteResources,
                        eq(roleSiteResources.roleId, roles.roleId)
                    )
                    .where(
                        and(
                            inArray(roles.roleId, roleIds),
                            eq(
                                roleSiteResources.siteResourceId,
                                (resource as SiteResource).siteResourceId
                            )
                        )
                    );
            } else {
                const publicResourceId = (resource as Resource).resourceId;
                const [directRoleRows, policyRoleRows] = await Promise.all([
                    db
                        .select({
                            roleId: roles.roleId,
                            sshSudoCommands: roles.sshSudoCommands,
                            sshUnixGroups: roles.sshUnixGroups,
                            sshCreateHomeDir: roles.sshCreateHomeDir,
                            sshSudoMode: roles.sshSudoMode
                        })
                        .from(roles)
                        .innerJoin(
                            roleResources,
                            eq(roleResources.roleId, roles.roleId)
                        )
                        .where(
                            and(
                                inArray(roles.roleId, roleIds),
                                eq(roleResources.resourceId, publicResourceId)
                            )
                        ),
                    db
                        .select({
                            roleId: roles.roleId,
                            sshSudoCommands: roles.sshSudoCommands,
                            sshUnixGroups: roles.sshUnixGroups,
                            sshCreateHomeDir: roles.sshCreateHomeDir,
                            sshSudoMode: roles.sshSudoMode
                        })
                        .from(roles)
                        .innerJoin(
                            rolePolicies,
                            eq(rolePolicies.roleId, roles.roleId)
                        )
                        .innerJoin(
                            resources,
                            or(
                                eq(
                                    resources.resourcePolicyId,
                                    rolePolicies.resourcePolicyId
                                ),
                                and(
                                    isNull(resources.resourcePolicyId),
                                    eq(
                                        resources.defaultResourcePolicyId,
                                        rolePolicies.resourcePolicyId
                                    )
                                )
                            )
                        )
                        .where(
                            and(
                                inArray(roles.roleId, roleIds),
                                eq(resources.resourceId, publicResourceId)
                            )
                        )
                ]);

                const uniqueByRoleId = new Map<number, RoleSshMeta>();
                for (const row of [...directRoleRows, ...policyRoleRows]) {
                    if (!uniqueByRoleId.has(row.roleId)) {
                        uniqueByRoleId.set(row.roleId, row);
                    }
                }
                roleRows = Array.from(uniqueByRoleId.values());
            }

            const parsedSudoCommands: string[] = [];
            const parsedGroupsSet = new Set<string>();
            let homedir: boolean | null = null;
            const sudoModeOrder = { none: 0, commands: 1, full: 2 };
            let sudoMode: "none" | "commands" | "full" = "none";
            for (const roleRow of roleRows) {
                try {
                    const cmds = JSON.parse(roleRow?.sshSudoCommands ?? "[]");
                    if (Array.isArray(cmds)) parsedSudoCommands.push(...cmds);
                } catch {
                    // skip
                }
                try {
                    const grps = JSON.parse(roleRow?.sshUnixGroups ?? "[]");
                    if (Array.isArray(grps))
                        grps.forEach((g: string) => parsedGroupsSet.add(g));
                } catch {
                    // skip
                }
                if (roleRow?.sshCreateHomeDir === true) homedir = true;
                const m = roleRow?.sshSudoMode ?? "none";
                if (
                    sudoModeOrder[m as keyof typeof sudoModeOrder] >
                    sudoModeOrder[sudoMode]
                ) {
                    sudoMode = m as "none" | "commands" | "full";
                }
            }
            const parsedGroups = Array.from(parsedGroupsSet);
            if (homedir === null && roleRows.length > 0) {
                homedir = roleRows[0].sshCreateHomeDir ?? null;
            }

            // Sign the public key
            const now = BigInt(Math.floor(Date.now() / 1000));
            // only valid for 5 minutes
            const validFor = 300n;
            expiresIn = Number(validFor); // seconds

            cert = signPublicKey(caKeys.privateKeyPem, publicKey, {
                keyId: `${usernameToUse}@${resource.niceId}`,
                validPrincipals: [usernameToUse, resource.niceId],
                validAfter: now - 60n, // Start 1 min ago for clock skew
                validBefore: now + validFor
            });

            messageIds = [];
            for (const siteId of siteIds) {
                // get the site
                const [newt] = await db
                    .select()
                    .from(newts)
                    .where(eq(newts.siteId, siteId))
                    .limit(1);

                if (!newt) {
                    return next(
                        createHttpError(
                            HttpCode.INTERNAL_SERVER_ERROR,
                            "Site associated with resource not found"
                        )
                    );
                }

                const [message] = await db
                    .insert(roundTripMessageTracker)
                    .values({
                        wsClientId: newt.newtId,
                        messageType: `newt/pam/connection`,
                        sentAt: Math.floor(Date.now() / 1000)
                    })
                    .returning();

                if (!message) {
                    return next(
                        createHttpError(
                            HttpCode.INTERNAL_SERVER_ERROR,
                            "Failed to create message tracker entry"
                        )
                    );
                }

                messageIds.push(message.messageId);

                const agentHost = siteAgentHostMap.get(siteId);

                await sendToClient(newt.newtId, {
                    type: `newt/pam/connection`,
                    data: {
                        messageId: message.messageId,
                        orgId: orgId,
                        agentPort: resource.authDaemonPort ?? 22123,
                        authDaemonMode: resource.authDaemonMode, // site, remote, native where native is the pty mode
                        externalAuthDaemon:
                            resource.authDaemonMode === "remote", // keep this for backward compatibility but new newts are using the authDaemonMode field
                        agentHost,
                        caCert: caKeys.publicKeyOpenSSH,
                        username: usernameToUse,
                        niceId: resource.niceId,
                        metadata: {
                            sudoMode: sudoMode,
                            sudoCommands: parsedSudoCommands,
                            homedir: homedir,
                            groups: parsedGroups
                        }
                    }
                });
            }
        } else if (resource.pamMode === "passthrough") {
            usernameToUse = username;
            if (!usernameToUse) {
                return next(
                    createHttpError(
                        HttpCode.BAD_REQUEST,
                        "Username must be provided when PAM mode is passthrough"
                    )
                );
            }
        } else {
            return next(
                createHttpError(
                    HttpCode.INTERNAL_SERVER_ERROR,
                    "Invalid PAM mode configured for resource"
                )
            );
        }

        let sshHost: string | undefined;
        if (
            resource.authDaemonMode === "site" ||
            resource.authDaemonMode === "remote"
        ) {
            if (type === "private") {
                const privateResource = resource as SiteResource;
                if (privateResource.alias && privateResource.alias !== "") {
                    sshHost = privateResource.alias;
                } else {
                    sshHost = privateResource.destination || "";
                }
            } else {
                const publicResource = resource as Resource;
                sshHost =
                    publicResource.fullDomain ||
                    publicResource.subdomain ||
                    publicResource.niceId;
            }
        } else if (resource.authDaemonMode === "native") {
            if (siteIds.length > 1) {
                return next(
                    createHttpError(
                        HttpCode.INTERNAL_SERVER_ERROR,
                        "Multiple sites associated with resource, unable to determine SSH host when in native mode"
                    )
                );
            }

            // get the site
            const [site] = await db
                .select()
                .from(sites)
                .where(eq(sites.siteId, siteIds[0]))
                .limit(1);

            if (!site) {
                return next(
                    createHttpError(
                        HttpCode.INTERNAL_SERVER_ERROR,
                        "Site associated with resource not found"
                    )
                );
            }

            if (!site.address) {
                return next(
                    createHttpError(
                        HttpCode.INTERNAL_SERVER_ERROR,
                        "Site address not configured, unable to determine SSH host when in native mode"
                    )
                );
            }

            // its the address but split off the cidr if there is one
            sshHost = site.address.split("/")[0];
        }

        if (!sshHost) {
            return next(
                createHttpError(
                    HttpCode.INTERNAL_SERVER_ERROR,
                    "Unable to determine SSH host for the resource"
                )
            );
        }

        await logsDb.insert(actionAuditLog).values({
            timestamp: Math.floor(Date.now() / 1000),
            orgId: orgId,
            actorType: "user",
            actor: req.user?.username ?? "",
            actorId: req.user?.userId ?? "",
            action: ActionsEnum.signSshKey,
            metadata: JSON.stringify({
                resourceId: normalizedResourceId,
                resourceType: type,
                resource: resource.name,
                siteIds: siteIds
            })
        });

        await logAccessAudit({
            action: true,
            type: "ssh",
            orgId: orgId,
            resourceId:
                type === "public"
                    ? (resource as Resource).resourceId
                    : undefined,
            siteResourceId:
                type === "private"
                    ? (resource as SiteResource).siteResourceId
                    : undefined,
            user: req.user
                ? { username: req.user.username ?? "", userId: req.user.userId }
                : undefined,
            metadata: {
                resourceName: resource.name,
                siteIds: siteIds,
                sshUsername: usernameToUse,
                sshHost: sshHost
            },
            userAgent: req.headers["user-agent"],
            requestIp: req.ip
        });

        return response<SignSshKeyResponse>(res, {
            data: {
                certificate: cert?.certificate,
                messageIds: messageIds,
                messageId: messageIds[0], // just pick the first one for backward compatibility with older olms
                sshUsername: usernameToUse,
                sshHost: sshHost, // just pick the first one for backward compatibility with older olms
                resourceId: normalizedResourceId,
                siteIds: siteIds,
                siteId: siteIds[0], // just pick the first one for backward compatibility with older olms
                keyId: cert?.keyId,
                authDaemonMode: resource.authDaemonMode,
                validPrincipals: cert?.validPrincipals,
                validAfter: cert?.validAfter.toISOString(),
                validBefore: cert?.validBefore.toISOString(),
                expiresIn
            },
            success: true,
            error: false,
            message: "SSH key signed successfully",
            status: HttpCode.OK
        });
    } catch (error) {
        logger.error("Error signing SSH key:", error);
        return next(
            createHttpError(
                HttpCode.INTERNAL_SERVER_ERROR,
                "An error occurred while signing the SSH key"
            )
        );
    }
}
