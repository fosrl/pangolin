import { Request, Response, NextFunction } from "express";
import { clients, db } from "@server/db";
import { apiKeyOrg } from "@server/db";
import { and, eq } from "drizzle-orm";
import createHttpError from "http-errors";
import HttpCode from "@server/types/HttpCode";
import { ownApiKeyOrg } from "@server/lib/requestAuthState";

export async function verifyApiKeyClientAccess(
    req: Request,
    res: Response,
    next: NextFunction
) {
    try {
        const apiKey = req.apiKey;
        const clientId = parseInt(
            req.params.clientId || req.body.clientId || req.query.clientId
        );

        if (!apiKey) {
            return next(
                createHttpError(HttpCode.UNAUTHORIZED, "Key not authenticated")
            );
        }

        if (isNaN(clientId)) {
            return next(
                createHttpError(HttpCode.BAD_REQUEST, "Invalid client ID")
            );
        }

        if (apiKey.isRoot) {
            // Root keys can access any key in any org
            return next();
        }

        const client = await db
            .select()
            .from(clients)
            .where(eq(clients.clientId, clientId))
            .limit(1);

        if (client.length === 0) {
            return next(
                createHttpError(
                    HttpCode.NOT_FOUND,
                    `Client with ID ${clientId} not found`
                )
            );
        }

        if (!client[0].orgId) {
            return next(
                createHttpError(
                    HttpCode.INTERNAL_SERVER_ERROR,
                    `Client with ID ${clientId} does not have an organization ID`
                )
            );
        }

        if (!ownApiKeyOrg(req)) {
            const apiKeyOrgRes = await db
                .select()
                .from(apiKeyOrg)
                .where(
                    and(
                        eq(apiKeyOrg.apiKeyId, apiKey.apiKeyId),
                        eq(apiKeyOrg.orgId, client[0].orgId)
                    )
                );
            req.apiKeyOrg = apiKeyOrgRes[0];
        }

        if (!req.apiKeyOrg || ownApiKeyOrg(req)?.orgId !== client[0].orgId) {
            return next(
                createHttpError(
                    HttpCode.FORBIDDEN,
                    "Key does not have access to this organization"
                )
            );
        }

        return next();
    } catch (error) {
        return next(
            createHttpError(
                HttpCode.INTERNAL_SERVER_ERROR,
                "Error verifying site access"
            )
        );
    }
}
