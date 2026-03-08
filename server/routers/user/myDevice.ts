import { Request, Response, NextFunction } from "express";
import { db, Olm, olms, orgs, userOrgs } from "@server/db";
import { idp, users } from "@server/db";
import { and, eq } from "drizzle-orm";
import response from "@server/lib/response";
import HttpCode from "@server/types/HttpCode";
import createHttpError from "http-errors";
import logger from "@server/logger";
import { GetUserResponse } from "./getUser";
import { z } from "zod";
import { fromError } from "zod-validation-error";

const querySchema = z.object({
    olmId: z.string()
});

type ResponseOrg = {
    orgId: string;
    orgName: string;
    roleId: number;
};

export type MyDeviceResponse = {
    user: GetUserResponse;
    orgs: ResponseOrg[];
    olm: Olm | null;
};

export async function myDevice(
    req: Request,
    res: Response,
    next: NextFunction
): Promise<any> {
    try {
        const parsedQuery = querySchema.safeParse(req.query);
        if (!parsedQuery.success) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    fromError(parsedQuery.error)
                )
            );
        }

        const { olmId } = parsedQuery.data;

        const userId = req.user?.userId;

        if (!userId) {
            return next(
                createHttpError(HttpCode.UNAUTHORIZED, "User not found")
            );
        }

        const [user] = await db
            .select({
                userId: users.userId,
                email: users.email,
                username: users.username,
                name: users.name,
                type: users.type,
                twoFactorEnabled: users.twoFactorEnabled,
                emailVerified: users.emailVerified,
                serverAdmin: users.serverAdmin,
                idpName: idp.name,
                idpId: users.idpId,
                locale: users.locale
            })
            .from(users)
            .leftJoin(idp, eq(users.idpId, idp.idpId))
            .where(eq(users.userId, userId))
            .limit(1);

        if (!user) {
            return next(
                createHttpError(
                    HttpCode.NOT_FOUND,
                    `User with ID ${userId} not found`
                )
            );
        }

        const [olm] = await db
            .select()
            .from(olms)
            .where(and(eq(olms.userId, userId), eq(olms.olmId, olmId)));

        const userOrganizations = await db
            .select({
                orgId: userOrgs.orgId,
                orgName: orgs.name,
                roleId: userOrgs.roleId
            })
            .from(userOrgs)
            .where(eq(userOrgs.userId, userId))
            .innerJoin(orgs, eq(userOrgs.orgId, orgs.orgId));

        return response<MyDeviceResponse>(res, {
            data: {
                user,
                orgs: userOrganizations,
                olm
            },
            success: true,
            error: false,
            message: "My device retrieved successfully",
            status: HttpCode.OK
        });
    } catch (error) {
        logger.error(error);
        return next(
            createHttpError(HttpCode.INTERNAL_SERVER_ERROR, "An error occurred")
        );
    }
}
