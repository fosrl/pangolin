import { db, idp, idpOidcConfig, users } from "@server/db";
import { getLoginClaims } from "@server/lib/idp/loginClaims";
import {
    previewIdpLogin,
    type OidcTestResult
} from "@server/lib/idp/previewIdpLogin";
import response from "@server/lib/response";
import logger from "@server/logger";
import HttpCode from "@server/types/HttpCode";
import { eq } from "drizzle-orm";
import { NextFunction, Request, Response } from "express";
import createHttpError from "http-errors";
import { z } from "zod";
import { fromError } from "zod-validation-error";

const paramsSchema = z
    .object({
        orgId: z.string(),
        userId: z.string()
    })
    .strict();

export type GetOrgUserLoginClaimsResponse = {
    /** `null` for users that don't sign in with an OIDC IdP. */
    idp: {
        idpId: number;
        name: string;
        storeLoginClaims: boolean;
    } | null;
    /**
     * The claims of the user's last login, run through the org's current
     * mappings. `null` when nothing is stored.
     */
    result: OidcTestResult | null;
};

/**
 * The claims of an OIDC user's last login (when their IdP stores them), and
 * what this org's current mappings make of them.
 */
export async function getOrgUserLoginClaims(
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
        const { orgId, userId } = parsedParams.data;

        const [row] = await db
            .select({ idp, idpOidcConfig })
            .from(users)
            .innerJoin(idp, eq(idp.idpId, users.idpId))
            .innerJoin(idpOidcConfig, eq(idpOidcConfig.idpId, idp.idpId))
            .where(eq(users.userId, userId))
            .limit(1);

        if (!row) {
            return response<GetOrgUserLoginClaimsResponse>(res, {
                data: { idp: null, result: null },
                success: true,
                error: false,
                message: "User doesn't sign in with an OIDC identity provider",
                status: HttpCode.OK
            });
        }

        const snapshot = await getLoginClaims(userId);
        const result =
            snapshot && snapshot.idpId === row.idp.idpId
                ? await previewIdpLogin({
                      existingIdp: row,
                      claims: snapshot.claims,
                      enrichedClaimKeys: snapshot.enrichedClaimKeys,
                      onlyOrgId: orgId,
                      testedAt: snapshot.capturedAt
                  })
                : null;

        return response<GetOrgUserLoginClaimsResponse>(res, {
            data: {
                idp: {
                    idpId: row.idp.idpId,
                    name: row.idp.name,
                    storeLoginClaims: row.idp.storeLoginClaims
                },
                result
            },
            success: true,
            error: false,
            message: "Login claims retrieved",
            status: HttpCode.OK
        });
    } catch (error) {
        logger.error(error);
        return next(
            createHttpError(HttpCode.INTERNAL_SERVER_ERROR, "An error occurred")
        );
    }
}
