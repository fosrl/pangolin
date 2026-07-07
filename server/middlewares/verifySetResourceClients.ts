import { Request, Response, NextFunction } from "express";
import { db } from "@server/db";
import { clients } from "@server/db";
import { and, eq, inArray } from "drizzle-orm";
import createHttpError from "http-errors";
import HttpCode from "@server/types/HttpCode";
import { checkOrgAccessPolicy } from "#dynamic/lib/checkOrgAccessPolicy";

export async function verifySetResourceClients(
    req: Request,
    res: Response,
    next: NextFunction
) {
    const userId = req.user!.userId;
    const singleClientId =
        req.params.clientId || req.body.clientId || req.query.clientId;
    const { clientIds } = req.body;
    const allClientIds =
        clientIds ||
        (singleClientId ? [parseInt(singleClientId as string)] : []);

    if (!userId) {
        return next(
            createHttpError(HttpCode.UNAUTHORIZED, "User not authenticated")
        );
    }

    if (!req.userOrg) {
        return next(
            createHttpError(
                HttpCode.FORBIDDEN,
                "User does not have access to this organization"
            )
        );
    }

    if (req.orgPolicyAllowed === undefined && req.userOrg.orgId) {
        const policyCheck = await checkOrgAccessPolicy({
            orgId: req.userOrg.orgId,
            userId,
            session: req.session
        });
        req.orgPolicyAllowed = policyCheck.allowed;
        if (!policyCheck.allowed || policyCheck.error) {
            return next(
                createHttpError(
                    HttpCode.FORBIDDEN,
                    "" + (policyCheck.error || "Unknown error")
                )
            );
        }
    }

    if (allClientIds.length === 0) {
        return next();
    }

    try {
        const orgId = req.userOrg.orgId;
        // get all clients for the clientIds
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
                    "User does not have access to one or more specified clients"
                )
            );
        }

        return next();
    } catch (error) {
        return next(
            createHttpError(
                HttpCode.INTERNAL_SERVER_ERROR,
                "Error checking if user has access to the specified clients"
            )
        );
    }
}
