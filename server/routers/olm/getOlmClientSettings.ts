import { NextFunction, Request, Response } from "express";
import { and, eq } from "drizzle-orm";
import createHttpError from "http-errors";
import { z } from "zod";
import { fromError } from "zod-validation-error";
import { clients, db, olms, siteNetworks, siteResources } from "@server/db";
import { verifyPassword } from "@server/auth/password";
import response from "@server/lib/response";
import config from "@server/lib/config";
import logger from "@server/logger";
import HttpCode from "@server/types/HttpCode";
import type { ClientSettings } from "@server/lib/clientSettings";
import { getClientSettingsForClient } from "#dynamic/lib/clientSettings";

export const olmClientSettingsBodySchema = z.strictObject({
    olmId: z.string().nonempty(),
    secret: z.string().nonempty(),
    orgId: z.string().optional()
});

export type OlmClientSettingsBody = z.infer<typeof olmClientSettingsBodySchema>;

export type OlmClientSettingsResponse = {
    settings: ClientSettings | null;
    // The sites behind settings.exitNodeSiteResourceId. A machine client has
    // no user session to look these up itself. Absent if no exit node is set,
    // or if it is disabled, gone or has no sites.
    exitNodeSiteIds?: number[];
};

// Client settings for a client that authenticates with its olm ID and secret
// rather than a user session, i.e. a machine client. User devices use
// GET /org/:orgId/my-client-settings instead, though a user device's olm gets
// the same answer here.
export async function getOlmClientSettings(
    req: Request,
    res: Response,
    next: NextFunction
): Promise<any> {
    const parsedBody = olmClientSettingsBodySchema.safeParse(req.body);
    if (!parsedBody.success) {
        return next(
            createHttpError(
                HttpCode.BAD_REQUEST,
                fromError(parsedBody.error).toString()
            )
        );
    }

    const { olmId, secret, orgId } = parsedBody.data;

    try {
        const [olm] = await db
            .select()
            .from(olms)
            .where(eq(olms.olmId, olmId))
            .limit(1);

        // Same response for an unknown olm and a wrong secret, so the
        // endpoint can't be used to probe for olm IDs.
        const validSecret = olm
            ? await verifyPassword(secret, olm.secretHash)
            : false;
        if (!olm || !validSecret) {
            if (config.getRawConfig().app.log_failed_attempts) {
                logger.info(
                    `Olm client settings: olm id or secret is incorrect. Olm: ID ${olmId}. IP: ${req.ip}.`
                );
            }
            return next(
                createHttpError(
                    HttpCode.UNAUTHORIZED,
                    "Olm ID or secret is incorrect"
                )
            );
        }

        const clientFilter = orgId
            ? and(eq(clients.orgId, orgId), eq(clients.olmId, olmId))
            : olm.clientId
              ? eq(clients.clientId, olm.clientId)
              : undefined;
        if (!clientFilter) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    "Olm is not associated with a client, orgId is required"
                )
            );
        }

        const [client] = await db
            .select({
                clientId: clients.clientId,
                orgId: clients.orgId,
                userId: clients.userId
            })
            .from(clients)
            .where(clientFilter)
            .limit(1);
        if (!client) {
            return next(
                createHttpError(HttpCode.NOT_FOUND, "Client not found")
            );
        }

        const settings = await getClientSettingsForClient(client);

        let exitNodeSiteIds: number[] | undefined;
        if (settings?.exitNodeSiteResourceId) {
            const rows = await db
                .select({ siteId: siteNetworks.siteId })
                .from(siteResources)
                .innerJoin(
                    siteNetworks,
                    eq(siteNetworks.networkId, siteResources.networkId)
                )
                .where(
                    and(
                        eq(
                            siteResources.siteResourceId,
                            settings.exitNodeSiteResourceId
                        ),
                        eq(siteResources.orgId, client.orgId),
                        eq(siteResources.mode, "gateway"),
                        eq(siteResources.enabled, true)
                    )
                );
            if (rows.length > 0) {
                exitNodeSiteIds = rows.map((r) => r.siteId);
            }
        }

        return response<OlmClientSettingsResponse>(res, {
            data: { settings: settings ?? null, exitNodeSiteIds },
            success: true,
            error: false,
            message: "Client settings retrieved successfully",
            status: HttpCode.OK
        });
    } catch (error) {
        logger.error(error);
        return next(
            createHttpError(HttpCode.INTERNAL_SERVER_ERROR, "An error occurred")
        );
    }
}
