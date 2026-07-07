import { Request, Response, NextFunction } from "express";
import { z } from "zod";
import {
    db,
    statusHistory,
    TargetHealthCheck,
    targetHealthCheck
} from "@server/db";
import { newts, resources, sites, Target, targets } from "@server/db";
import response from "@server/lib/response";
import HttpCode from "@server/types/HttpCode";
import createHttpError from "http-errors";
import logger from "@server/logger";
import { addPeer } from "../gerbil/peers";
import { isIpInCidr } from "@server/lib/ip";
import { fromError } from "zod-validation-error";
import { addTargets } from "../newt/targets";
import { eq } from "drizzle-orm";
import { pickPort } from "./helpers";
import { isTargetValid } from "@server/lib/validators";
import { OpenAPITags, registry } from "@server/openApi";
import {
    fireHealthCheckHealthyAlert,
    fireHealthCheckUnhealthyAlert,
    fireHealthCheckUnknownAlert
} from "@server/lib/alerts";
import { encrypt } from "@server/lib/crypto";
import { generateId } from "@server/auth/sessions/app";
import config from "@server/lib/config";
import { sendBrowserGatewayTargets } from "@server/routers/newt/targets";

const createTargetParamsSchema = z.strictObject({
    resourceId: z.coerce.number().int().positive()
});

const createTargetSchema = z
    .strictObject({
        siteId: z.int().positive(),
        ip: z.string().refine(isTargetValid),
        mode: z.enum(["http", "tcp", "udp", "ssh", "rdp", "vnc"]).optional(),
        method: z.string().optional().nullable(),
        port: z.int().min(1).max(65535),
        enabled: z.boolean().default(true),
        hcEnabled: z.boolean().optional(),
        hcPath: z.string().min(1).optional().nullable(),
        hcScheme: z.string().optional().nullable(),
        hcMode: z.string().optional().nullable(),
        hcHostname: z.string().optional().nullable(),
        hcPort: z.int().positive().optional().nullable(),
        hcInterval: z.int().positive().min(1).optional().nullable(),
        hcUnhealthyInterval: z.int().positive().min(1).optional().nullable(),
        hcTimeout: z.int().positive().min(1).optional().nullable(),
        hcHeaders: z
            .array(z.strictObject({ name: z.string(), value: z.string() }))
            .nullable()
            .optional(),
        hcFollowRedirects: z.boolean().optional().nullable(),
        hcMethod: z.string().min(1).optional().nullable(),
        hcStatus: z.int().optional().nullable(),
        hcTlsServerName: z.string().optional().nullable(),
        hcHealthyThreshold: z.int().positive().min(1).optional().nullable(),
        hcUnhealthyThreshold: z.int().positive().min(1).optional().nullable(),
        path: z.string().optional().nullable(),
        pathMatchType: z
            .enum(["exact", "prefix", "regex"])
            .optional()
            .nullable(),
        rewritePath: z.string().optional().nullable(),
        rewritePathType: z
            .enum(["exact", "prefix", "regex", "stripPrefix"])
            .optional()
            .nullable(),
        priority: z.int().min(1).max(1000).optional().nullable()
    })
    .superRefine((data, ctx) => {
        const hcHostnameMissing =
            data.hcHostname === undefined ||
            data.hcHostname === null ||
            data.hcHostname.trim().length === 0;

        if (data.hcEnabled === true && hcHostnameMissing) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                path: ["hcHostname"],
                message: "hcHostname is required when hcEnabled is true"
            });
        }
    });

export type CreateTargetResponse = Target & TargetHealthCheck;

registry.registerPath({
    method: "put",
    path: "/resource/{resourceId}/target",
    description: "Create a target for a resource.",
    tags: [OpenAPITags.PublicResource, OpenAPITags.Target],
    request: {
        params: createTargetParamsSchema,
        body: {
            content: {
                "application/json": {
                    schema: createTargetSchema
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

export async function createTarget(
    req: Request,
    res: Response,
    next: NextFunction
): Promise<any> {
    try {
        const parsedBody = createTargetSchema.safeParse(req.body);
        if (!parsedBody.success) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    fromError(parsedBody.error).toString()
                )
            );
        }

        const targetData = parsedBody.data;

        const parsedParams = createTargetParamsSchema.safeParse(req.params);
        if (!parsedParams.success) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    fromError(parsedParams.error).toString()
                )
            );
        }

        const { resourceId } = parsedParams.data;

        // get the resource
        const [resource] = await db
            .select()
            .from(resources)
            .where(eq(resources.resourceId, resourceId));

        if (!resource) {
            return next(
                createHttpError(
                    HttpCode.NOT_FOUND,
                    `Resource with ID ${resourceId} not found`
                )
            );
        }

        const siteId = targetData.siteId;

        const [site] = await db
            .select()
            .from(sites)
            .where(eq(sites.siteId, siteId))
            .limit(1);

        if (!site) {
            return next(
                createHttpError(
                    HttpCode.NOT_FOUND,
                    `Site with ID ${siteId} not found`
                )
            );
        }

        const plainToken = generateId(48);
        const encryptedToken = encrypt(
            plainToken,
            config.getRawConfig().server.secret!
        );

        let newTarget: Target[] = [];
        let targetIps: string[] = [];
        let healthCheck: TargetHealthCheck[] = [];
        await db.transaction(async (trx) => {
            const existingTargets = await trx
                .select()
                .from(targets)
                .where(eq(targets.resourceId, resourceId));

            const existingTarget = existingTargets.find(
                (target) =>
                    target.ip === targetData.ip &&
                    target.port === targetData.port &&
                    target.method === targetData.method &&
                    target.siteId === targetData.siteId
            );

            if (existingTarget) {
                // log a warning
                logger.warn(
                    `Target with IP ${targetData.ip}, port ${targetData.port}, method ${targetData.method} already exists for resource ID ${resourceId}`
                );
            }

            if (site.type == "local") {
                newTarget = await trx
                    .insert(targets)
                    .values({
                        resourceId,
                        ...targetData,
                        mode: (targetData.mode ??
                            resource.mode ??
                            "http") as Target["mode"],
                        priority: targetData.priority || 100
                    })
                    .returning();
            } else {
                // make sure the target is within the site subnet
                if (
                    site.type == "wireguard" &&
                    !isIpInCidr(targetData.ip, site.subnet!)
                ) {
                    return next(
                        createHttpError(
                            HttpCode.BAD_REQUEST,
                            `Target IP is not within the site subnet`
                        )
                    );
                }

                const { internalPort, targetIps: newTargetIps } =
                    await pickPort(site.siteId!, trx);

                if (!internalPort) {
                    return next(
                        createHttpError(
                            HttpCode.BAD_REQUEST,
                            `No available internal port`
                        )
                    );
                }

                newTarget = await trx
                    .insert(targets)
                    .values({
                        resourceId,
                        siteId: site.siteId,
                        ip: targetData.ip,
                        mode: (targetData.mode ??
                            resource.mode ??
                            "http") as Target["mode"],
                        authToken: encryptedToken,
                        method: targetData.method,
                        port: targetData.port,
                        internalPort,
                        enabled: targetData.enabled,
                        path: targetData.path,
                        pathMatchType: targetData.pathMatchType,
                        rewritePath: targetData.rewritePath,
                        rewritePathType: targetData.rewritePathType,
                        priority: targetData.priority || 100
                    })
                    .returning();

                // add the new target to the targetIps array
                newTargetIps.push(`${targetData.ip}/32`);

                targetIps = newTargetIps;
            }

            let hcHeaders = null;
            if (targetData.hcHeaders) {
                hcHeaders = JSON.stringify(targetData.hcHeaders);
            }

            healthCheck = await trx
                .insert(targetHealthCheck)
                .values({
                    orgId: resource.orgId,
                    targetId: newTarget[0].targetId,
                    siteId: targetData.siteId,
                    name: `Resource ${resource.name} - ${targetData.ip}:${targetData.port}`,
                    hcEnabled: targetData.hcEnabled ?? false,
                    hcPath: targetData.hcPath ?? null,
                    hcScheme: targetData.hcScheme ?? null,
                    hcMode: targetData.hcMode ?? null,
                    hcHostname: targetData.hcHostname ?? null,
                    hcPort: targetData.hcPort ?? null,
                    hcInterval: targetData.hcInterval ?? null,
                    hcUnhealthyInterval: targetData.hcUnhealthyInterval ?? null,
                    hcTimeout: targetData.hcTimeout ?? null,
                    hcHeaders: hcHeaders,
                    hcFollowRedirects: targetData.hcFollowRedirects ?? null,
                    hcMethod: targetData.hcMethod ?? null,
                    hcStatus: targetData.hcStatus ?? null,
                    hcHealth: targetData.hcEnabled ? "unhealthy" : "unknown",
                    hcTlsServerName: targetData.hcTlsServerName ?? null,
                    hcHealthyThreshold: targetData.hcHealthyThreshold ?? null,
                    hcUnhealthyThreshold:
                        targetData.hcUnhealthyThreshold ?? null
                })
                .returning();

            if (healthCheck[0].hcHealth === "unhealthy") {
                await fireHealthCheckUnhealthyAlert(
                    healthCheck[0].orgId,
                    healthCheck[0].targetHealthCheckId,
                    healthCheck[0].name || "",
                    healthCheck[0].targetId,
                    undefined,
                    false, // dont send the alert because we just want to create the alert, not notify users yet
                    trx
                );
            } else if (healthCheck[0].hcHealth === "unknown") {
                // if the health is unknown, we want to fire an alert to notify users to enable health checks
                await fireHealthCheckUnknownAlert(
                    healthCheck[0].orgId,
                    healthCheck[0].targetHealthCheckId,
                    healthCheck[0].name,
                    healthCheck[0].targetId,
                    undefined,
                    false, // dont send the alert because we just want to create the alert, not notify users yet
                    trx
                );
            } else if (healthCheck[0].hcHealth === "healthy") {
                await fireHealthCheckHealthyAlert(
                    healthCheck[0].orgId,
                    healthCheck[0].targetHealthCheckId,
                    healthCheck[0].name || "",
                    healthCheck[0].targetId,
                    undefined,
                    false, // dont send the alert because we just want to create the alert, not notify users yet
                    trx
                );
            }
        });

        if (site.pubKey) {
            if (site.type == "wireguard") {
                await addPeer(site.exitNodeId!, {
                    publicKey: site.pubKey,
                    allowedIps: targetIps.flat()
                });
            } else if (site.type == "newt") {
                // get the newt on the site by querying the newt table for siteId
                const [newt] = await db
                    .select()
                    .from(newts)
                    .where(eq(newts.siteId, site.siteId))
                    .limit(1);

                if (["http", "tcp", "udp"].includes(newTarget[0].mode)) {
                    await addTargets(
                        newt.newtId,
                        newTarget,
                        healthCheck,
                        resource.mode === "udp" ? "udp" : "tcp",
                        newt.version
                    );
                } else if (["ssh", "rdp", "vnc"].includes(newTarget[0].mode)) {
                    await sendBrowserGatewayTargets(
                        newt.newtId,
                        newTarget,
                        newt.version
                    );
                }
            }
        }

        return response<CreateTargetResponse>(res, {
            data: {
                ...healthCheck[0],
                ...newTarget[0]
            },
            success: true,
            error: false,
            message: "Target created successfully",
            status: HttpCode.CREATED
        });
    } catch (error) {
        logger.error(error);
        return next(
            createHttpError(HttpCode.INTERNAL_SERVER_ERROR, "An error occurred")
        );
    }
}
