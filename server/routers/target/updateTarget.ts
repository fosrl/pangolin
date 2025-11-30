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
import { pickPort } from "./helpers";
import { isTargetValid } from "@server/lib/validators";
import { OpenAPITags, registry } from "@server/openApi";
import { vs } from "@react-email/components";

const updateTargetParamsSchema = z
    .object({
        targetId: z.string().transform(Number).pipe(z.number().int().positive())
    })
    .strict();

const updateTargetBodySchema = z
    .object({
        siteId: z.number().int().positive(),
        ip: z.string().refine(isTargetValid),
        method: z.string().min(1).max(10).optional().nullable(),
        port: z.number().int().min(1).max(65535).optional(),
        enabled: z.boolean().optional(),
        hcEnabled: z.boolean().optional().nullable(),
        hcPath: z.string().min(1).optional().nullable(),
        hcScheme: z.string().optional().nullable(),
        hcMode: z.string().optional().nullable(),
        hcHostname: z.string().optional().nullable(),
        hcPort: z.number().int().positive().optional().nullable(),
        hcInterval: z.number().int().positive().min(5).optional().nullable(),
        hcUnhealthyInterval: z
            .number()
            .int()
            .positive()
            .min(5)
            .optional()
            .nullable(),
        hcTimeout: z.number().int().positive().min(1).optional().nullable(),
        hcHeaders: z.array(z.object({ name: z.string(), value: z.string() })).nullable().optional(),
        hcFollowRedirects: z.boolean().optional().nullable(),
        hcMethod: z.string().min(1).optional().nullable(),
        hcStatus: z.number().int().optional().nullable(),
        path: z.string().optional().nullable(),
        pathMatchType: z.enum(["exact", "prefix", "regex"]).optional().nullable(),
        rewritePath: z.string().optional().nullable(),
        rewritePathType: z.enum(["exact", "prefix", "regex", "stripPrefix"]).optional().nullable(),
        priority: z.number().int().min(1).max(1000).optional(),
    })
    .strict()
    .refine((data) => Object.keys(data).length > 0, {
        message: "At least one field must be provided for update"
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
    responses: {}
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

        const targetData = {
            ...target,
            ...parsedBody.data
        };

        const existingTargets = await db
            .select()
            .from(targets)
            .where(eq(targets.resourceId, target.resourceId));

        const foundTarget = existingTargets.find(
            (target) =>
                target.targetId !== targetId && // Exclude the current target being updated
                target.ip === targetData.ip &&
                target.port === targetData.port &&
                target.method === targetData.method &&
                target.siteId === targetData.siteId
        );

        if (foundTarget) {
            // log a warning
            logger.warn(`Target with IP ${targetData.ip}, port ${targetData.port}, method ${targetData.method} already exists for resource ID ${target.resourceId}`);
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

        const [updatedTarget] = await db
            .update(targets)
            .set({
                siteId: parsedBody.data.siteId,
                ip: parsedBody.data.ip,
                method: parsedBody.data.method,
                port: parsedBody.data.port,
                internalPort,
                enabled: parsedBody.data.enabled,
                path: parsedBody.data.path,
                pathMatchType: parsedBody.data.pathMatchType,
                priority: parsedBody.data.priority,
                rewritePath: parsedBody.data.rewritePath,
                rewritePathType: parsedBody.data.rewritePathType
            })
            .where(eq(targets.targetId, targetId))
            .returning();

        let hcHeaders = null;
        if (parsedBody.data.hcHeaders) {
            hcHeaders = JSON.stringify(parsedBody.data.hcHeaders);
        }

        const [updatedHc] = await db
            .update(targetHealthCheck)
            .set({
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
                hcStatus: parsedBody.data.hcStatus
            })
            .where(eq(targetHealthCheck.targetId, targetId))
            .returning();

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

                await addTargets(
                    newt.newtId,
                    [updatedTarget],
                    [updatedHc],
                    resource.protocol,
                    resource.proxyPort
                );
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
