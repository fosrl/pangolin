import { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { db, targetHealthCheck } from "@server/db";
import { newts, resources, sites, targets } from "@server/db";
import { eq } from "drizzle-orm";
import response from "@server/lib/response";
import HttpCode from "@server/types/HttpCode";
import createHttpError from "http-errors";
import logger from "@server/logger";
import { fromError } from "zod-validation-error";
import { addPeer } from "../gerbil/peers";
import { addTargets } from "../newt/targets";
import {
    fireHealthCheckHealthyAlert,
    fireHealthCheckUnknownAlert,
    fireHealthCheckUnhealthyAlert
} from "@server/lib/alerts";
import { pickPort } from "./helpers";
import { isTargetValid } from "@server/lib/validators";
import { OpenAPITags, registry } from "@server/openApi";
import { sendBrowserGatewayTargets } from "@server/routers/newt/targets";

const updateTargetParamsSchema = z.strictObject({
    targetId: z.coerce.number().int().positive()
});

const updateTargetBodySchema = z
    .strictObject({
        siteId: z.int().positive(),
        ip: z.string().refine(isTargetValid),
        mode: z
            .enum(["http", "tcp", "udp", "ssh", "rdp", "vnc"])
            .optional()
            .nullable(),
        method: z.string().min(1).max(10).optional().nullable(),
        port: z.int().min(1).max(65535).optional(),
        enabled: z.boolean().optional(),
        hcEnabled: z.boolean().optional().nullable(),
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
        priority: z.int().min(1).max(1000).optional()
    })
    .refine((data) => Object.keys(data).length > 0, {
        error: "At least one field must be provided for update"
    });

registry.registerPath({
    method: "post",
    path: "/target/{targetId}",
    description: "Update a target.",
    tags: [OpenAPITags.Target],
    request: {
        params: updateTargetParamsSchema,
        body: {
            content: {
                "application/json": {
                    schema: updateTargetBodySchema
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

export async function updateTarget(
    req: Request,
    res: Response,
    next: NextFunction
): Promise<any> {
    try {
        const parsedParams = updateTargetParamsSchema.safeParse(req.params);
        if (!parsedParams.success) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    fromError(parsedParams.error).toString()
                )
            );
        }

        const parsedBody = updateTargetBodySchema.safeParse(req.body);
        if (!parsedBody.success) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    fromError(parsedBody.error).toString()
                )
            );
        }

        const { targetId } = parsedParams.data;
        const { siteId } = parsedBody.data;

        const [target] = await db
            .select()
            .from(targets)
            .where(eq(targets.targetId, targetId))
            .limit(1);

        if (!target) {
            return next(
                createHttpError(
                    HttpCode.NOT_FOUND,
                    `Target with ID ${targetId} not found`
                )
            );
        }

        // get the resource
        const [resource] = await db
            .select()
            .from(resources)
            .where(eq(resources.resourceId, target.resourceId!));

        if (!resource) {
            return next(
                createHttpError(
                    HttpCode.NOT_FOUND,
                    `Resource with ID ${target.resourceId} not found`
                )
            );
        }

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

        const { internalPort, targetIps } = await pickPort(site.siteId!, db);

        if (!internalPort) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    `No available internal port`
                )
            );
        }

        const [existingHc] = await db
            .select()
            .from(targetHealthCheck)
            .where(eq(targetHealthCheck.targetId, targetId))
            .limit(1);

        if (!existingHc) {
            return next(
                createHttpError(
                    HttpCode.NOT_FOUND,
                    `Health check for target with ID ${targetId} not found`
                )
            );
        }

        const nextHcEnabled = parsedBody.data.hcEnabled ?? existingHc.hcEnabled;
        const nextHcHostname =
            parsedBody.data.hcHostname !== undefined
                ? parsedBody.data.hcHostname
                : existingHc.hcHostname;
        const hcHostnameMissing =
            !nextHcHostname || nextHcHostname.trim().length === 0;

        if (nextHcEnabled && hcHostnameMissing) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    "hcHostname is required when hcEnabled is true"
                )
            );
        }

        const pathMatchTypeRemoved = parsedBody.data.pathMatchType === null;
        const nextMode =
            parsedBody.data.mode === null ? undefined : parsedBody.data.mode;

        let updatedTarget: any;
        let updatedHc: any;
        await db.transaction(async (trx) => {
            [updatedTarget] = await trx
                .update(targets)
                .set({
                    siteId: parsedBody.data.siteId,
                    ip: parsedBody.data.ip,
                    mode: nextMode,
                    method: parsedBody.data.method,
                    port: parsedBody.data.port,
                    internalPort,
                    enabled: parsedBody.data.enabled,
                    path: parsedBody.data.path,
                    pathMatchType: parsedBody.data.pathMatchType,
                    priority: parsedBody.data.priority,
                    rewritePath: pathMatchTypeRemoved
                        ? null
                        : parsedBody.data.rewritePath,
                    rewritePathType: pathMatchTypeRemoved
                        ? null
                        : parsedBody.data.rewritePathType
                })
                .where(eq(targets.targetId, targetId))
                .returning();

            let hcHeaders = null;
            if (parsedBody.data.hcHeaders) {
                hcHeaders = JSON.stringify(parsedBody.data.hcHeaders);
            }

            // When health check is disabled, reset hcHealth to "unknown"
            // to prevent previously unhealthy targets from being excluded.
            // Also when the site is not a newt, set hcHealth to "unknown".
            // If hcEnabled is being turned on (was false, now true), set to "unhealthy"
            // so the target must pass a health check before being considered healthy.
            const hcEnabledTurnedOn =
                parsedBody.data.hcEnabled === true &&
                existingHc.hcEnabled === false;

            let hcHealthValue: "unknown" | "healthy" | "unhealthy" | undefined;
            if (
                parsedBody.data.hcEnabled === false ||
                parsedBody.data.hcEnabled === null ||
                site.type !== "newt"
            ) {
                hcHealthValue = "unknown";
            } else if (hcEnabledTurnedOn) {
                hcHealthValue = "unhealthy";
            } else {
                hcHealthValue = undefined;
            }

            [updatedHc] = await trx
                .update(targetHealthCheck)
                .set({
                    siteId: parsedBody.data.siteId,
                    hcEnabled: parsedBody.data.hcEnabled || false,
                    hcPath: parsedBody.data.hcPath,
                    hcScheme: parsedBody.data.hcScheme,
                    hcMode: parsedBody.data.hcMode,
                    hcHostname: parsedBody.data.hcHostname,
                    hcPort: parsedBody.data.hcPort,
                    hcInterval: parsedBody.data.hcInterval,
                    hcUnhealthyInterval: parsedBody.data.hcUnhealthyInterval,
                    hcTimeout: parsedBody.data.hcTimeout,
                    hcHeaders: hcHeaders,
                    hcFollowRedirects: parsedBody.data.hcFollowRedirects,
                    hcMethod: parsedBody.data.hcMethod,
                    hcStatus: parsedBody.data.hcStatus,
                    hcTlsServerName: parsedBody.data.hcTlsServerName,
                    hcHealthyThreshold: parsedBody.data.hcHealthyThreshold,
                    hcUnhealthyThreshold: parsedBody.data.hcUnhealthyThreshold,
                    hcHealth: hcHealthValue
                })
                .where(eq(targetHealthCheck.targetId, targetId))
                .returning();

            if (
                updatedHc.hcHealth === "unhealthy" &&
                existingHc.hcHealth !== "unhealthy"
            ) {
                logger.debug(
                    `Health check ${updatedHc.targetHealthCheckId} for target ${targetId} is now unhealthy, firing alert`
                );
                await fireHealthCheckUnhealthyAlert(
                    updatedHc.orgId,
                    updatedHc.targetHealthCheckId,
                    updatedHc.name || "",
                    updatedHc.targetId,
                    undefined,
                    false, // dont send the alert because we just want to create the alert, not notify users yet
                    trx
                );
            } else if (
                updatedHc.hcHealth === "unknown" &&
                existingHc.hcHealth !== "unknown"
            ) {
                logger.debug(
                    `Health check ${updatedHc.targetHealthCheckId} for target ${targetId} is now unknown, firing alert`
                );
                // if the health is unknown, we want to fire an alert to notify users to enable health checks
                await fireHealthCheckUnknownAlert(
                    updatedHc.orgId,
                    updatedHc.targetHealthCheckId,
                    updatedHc.name,
                    updatedHc.targetId,
                    undefined,
                    false, // dont send the alert because we just want to create the alert, not notify users yet
                    trx
                );
            } else if (
                updatedHc.hcHealth === "healthy" &&
                existingHc.hcHealth !== "healthy"
            ) {
                logger.debug(
                    `Health check ${updatedHc.targetHealthCheckId} for target ${targetId} is now healthy, firing alert`
                );
                await fireHealthCheckHealthyAlert(
                    updatedHc.orgId,
                    updatedHc.targetHealthCheckId,
                    updatedHc.name,
                    updatedHc.targetId,
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

                if (["http", "tcp", "udp"].includes(updatedTarget.mode)) {
                    await addTargets(
                        newt.newtId,
                        [updatedTarget],
                        [updatedHc],
                        resource.mode === "udp" ? "udp" : "tcp",
                        newt.version
                    );
                } else if (["ssh", "rdp", "vnc"].includes(updatedTarget.mode)) {
                    await sendBrowserGatewayTargets(
                        newt.newtId,
                        [updatedTarget],
                        newt.version
                    );
                }
            }
        }

        return response(res, {
            data: {
                ...updatedTarget,
                ...updatedHc
            },
            success: true,
            error: false,
            message: "Target updated successfully",
            status: HttpCode.OK
        });
    } catch (error) {
        logger.error(error);
        return next(
            createHttpError(HttpCode.INTERNAL_SERVER_ERROR, "An error occurred")
        );
    }
}
