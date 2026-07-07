import { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { db } from "@server/db";
import { newts, resources, sites, targets } from "@server/db";
import { eq, ne, and } from "drizzle-orm";
import response from "@server/lib/response";
import HttpCode from "@server/types/HttpCode";
import createHttpError from "http-errors";
import logger from "@server/logger";
import { fromError } from "zod-validation-error";
import { removeTargets } from "../newt/targets";
import { OpenAPITags, registry } from "@server/openApi";
import { targetHealthCheck } from "@server/db";
import { removeBrowserGatewayTarget } from "@server/routers/newt/targets";

const deleteTargetSchema = z.strictObject({
    targetId: z.coerce.number().int().positive()
});

registry.registerPath({
    method: "delete",
    path: "/target/{targetId}",
    description: "Delete a target.",
    tags: [OpenAPITags.Target],
    request: {
        params: deleteTargetSchema
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

export async function deleteTarget(
    req: Request,
    res: Response,
    next: NextFunction
): Promise<any> {
    try {
        const parsedParams = deleteTargetSchema.safeParse(req.params);
        if (!parsedParams.success) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    fromError(parsedParams.error).toString()
                )
            );
        }

        const { targetId } = parsedParams.data;

        const [deletedHealthCheck] = await db
            .delete(targetHealthCheck)
            .where(eq(targetHealthCheck.targetId, targetId))
            .returning();

        const [deletedTarget] = await db
            .delete(targets)
            .where(eq(targets.targetId, targetId))
            .returning();

        if (!deletedTarget) {
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
            .where(eq(resources.resourceId, deletedTarget.resourceId!));

        if (!resource) {
            return next(
                createHttpError(
                    HttpCode.NOT_FOUND,
                    `Resource with ID ${deletedTarget.resourceId} not found`
                )
            );
        }

        // check if there are other targets on the resource
        const otherTargets = await db
            .select()
            .from(targets)
            .where(
                and(
                    eq(targets.resourceId, resource.resourceId),
                    ne(targets.targetId, targetId)
                )
            );

        if (otherTargets.length == 0) {
            // set the resource status
            await db
                .update(resources)
                .set({ health: "unknown" })
                .where(eq(resources.resourceId, resource.resourceId));
        }

        const [site] = await db
            .select()
            .from(sites)
            .where(eq(sites.siteId, deletedTarget.siteId))
            .limit(1);

        if (!site) {
            return next(
                createHttpError(
                    HttpCode.NOT_FOUND,
                    `Site with ID ${targets.siteId} not found`
                )
            );
        }

        if (site.pubKey) {
            if (site.type == "newt") {
                // get the newt on the site by querying the newt table for siteId
                const [newt] = await db
                    .select()
                    .from(newts)
                    .where(eq(newts.siteId, site.siteId))
                    .limit(1);

                if (["http", "tcp", "udp"].includes(deletedTarget.mode)) {
                    await removeTargets(
                        newt.newtId,
                        // [deletedTarget],
                        [], // deleting the target from newt causes issues because we cant unbind the port. this needs to be fixed in newt before we can do this
                        [deletedHealthCheck],
                        resource.mode === "udp" ? "udp" : "tcp",
                        newt.version
                    );
                } else if (["ssh", "rdp", "vnc"].includes(deletedTarget.mode)) {
                    await removeBrowserGatewayTarget(
                        newt.newtId,
                        deletedTarget.targetId,
                        newt.version
                    );
                }
            }
        }

        return response(res, {
            data: null,
            success: true,
            error: false,
            message: "Target deleted successfully",
            status: HttpCode.OK
        });
    } catch (error) {
        logger.error(error);
        return next(
            createHttpError(HttpCode.INTERNAL_SERVER_ERROR, "An error occurred")
        );
    }
}
