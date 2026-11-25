import { Request, Response, NextFunction } from "express";
import { db } from "@server/db";
import { clients } from "@server/db";
import { and, eq, inArray } from "drizzle-orm";
import createHttpError from "http-errors";
import HttpCode from "@server/types/HttpCode";
import { ownApiKeyOrg } from "@server/lib/requestAuthState";

export async function verifyApiKeySetResourceClients(
    req: Request,
    res: Response,
    next: NextFunction
) {
    const apiKey = req.apiKey;
    const singleClientId =
        req.params.clientId || req.body.clientId || req.query.clientId;
    const { clientIds } = req.body;
    const allClientIds =
        clientIds ||
        (singleClientId ? [parseInt(singleClientId as string)] : []);

    if (!apiKey) {
        return next(
            createHttpError(HttpCode.UNAUTHORIZED, "Key not authenticated")
        );
    }

    if (apiKey.isRoot) {
        // Root keys can access any client in any org
        return next();
    }

    if (!req.apiKeyOrg || !ownApiKeyOrg(req)) {
        return next(
            createHttpError(
                HttpCode.FORBIDDEN,
                "Key does not have access to this organization"
            )
        );
    }

    if (allClientIds.length === 0) {
        return next();
    }

    try {
        const orgId = req.apiKeyOrg.orgId;
        const clientsData = await db
            .select()
            .from(clients)
            .where(
                and(
                    inArray(clients.clientId, allClientIds),
                    eq(clients.orgId, orgId)
                )
            );

        if (clientsData.length !== allClientIds.length) {
            return next(
                createHttpError(
                    HttpCode.FORBIDDEN,
                    "Key does not have access to one or more specified clients"
                )
            );
        }

        return next();
    } catch (error) {
        return next(
            createHttpError(
                HttpCode.INTERNAL_SERVER_ERROR,
                "Error checking if key has access to the specified clients"
            )
        );
    }
}
