import { NextFunction, Request, Response } from "express";
import {
    db,
    exitNodes,
    exitNodeOrgs,
    ExitNode,
    ExitNodeOrg,
    RemoteExitNode
} from "@server/db";
import HttpCode from "@server/types/HttpCode";
import { z } from "zod";
import { remoteExitNodes } from "@server/db";
import createHttpError from "http-errors";
import response from "@server/lib/response";
import { fromError } from "zod-validation-error";
import { hashPassword } from "@server/auth/password";
import logger from "@server/logger";
import { and, eq } from "drizzle-orm";
import { OpenAPITags, registry } from "@server/openApi";
import { disconnectClient, sendToClient } from "#dynamic/routers/ws";

export const paramsSchema = z.object({
    orgId: z.string()
});

const bodySchema = z.strictObject({
    remoteExitNodeId: z.string().length(15),
    secret: z.string().length(48),
    disconnect: z.boolean().optional().default(true)
});

registry.registerPath({
    method: "put",
    path: "/re-key/{orgId}/regenerate-remote-exit-node-secret",
    description:
        "Regenerate the secret for a remote exit node. Optionally disconnects the node so it must reconnect with the new secret.",
    tags: [OpenAPITags.RemoteExitNode],
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
                        data: z.null(),
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

export async function reGenerateExitNodeSecret(
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
        const { remoteExitNodeId, secret, disconnect } = parsedBody.data;

        // Only allow re-keying a node that belongs to this org (a node can be
        // shared across several orgs; any of them may re-key it)
        const [existingRemoteExitNode] = await db
            .select({ remoteExitNodeId: remoteExitNodes.remoteExitNodeId })
            .from(remoteExitNodes)
            .innerJoin(
                exitNodeOrgs,
                eq(exitNodeOrgs.exitNodeId, remoteExitNodes.exitNodeId)
            )
            .where(
                and(
                    eq(remoteExitNodes.remoteExitNodeId, remoteExitNodeId),
                    eq(exitNodeOrgs.orgId, orgId)
                )
            )
            .limit(1);

        if (!existingRemoteExitNode) {
            return next(
                createHttpError(
                    HttpCode.NOT_FOUND,
                    "Remote Exit Node does not exist"
                )
            );
        }

        const secretHash = await hashPassword(secret);

        await db
            .update(remoteExitNodes)
            .set({ secretHash })
            .where(eq(remoteExitNodes.remoteExitNodeId, remoteExitNodeId));

        // Only disconnect if explicitly requested
        if (disconnect) {
            const payload = {
                type: `remoteExitNode/terminate`,
                data: {}
            };
            // Don't await this to prevent blocking the response
            sendToClient(
                existingRemoteExitNode.remoteExitNodeId,
                payload
            ).catch((error) => {
                logger.error(
                    "Failed to send termination message to remote exit node:",
                    error
                );
            });

            disconnectClient(existingRemoteExitNode.remoteExitNodeId).catch(
                (error) => {
                    logger.error(
                        "Failed to disconnect remote exit node after re-key:",
                        error
                    );
                }
            );
        }

        return response(res, {
            data: null,
            success: true,
            error: false,
            message: "Remote Exit Node secret updated successfully",
            status: HttpCode.OK
        });
    } catch (e) {
        logger.error("Failed to update remoteExitNode", e);
        return next(
            createHttpError(
                HttpCode.INTERNAL_SERVER_ERROR,
                "Failed to update remoteExitNode"
            )
        );
    }
}
