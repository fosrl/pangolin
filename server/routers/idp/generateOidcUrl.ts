import { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { db } from "@server/db";
import response from "@server/lib/response";
import HttpCode from "@server/types/HttpCode";
import createHttpError from "http-errors";
import logger from "@server/logger";
import { fromError } from "zod-validation-error";
import { idp, idpOidcConfig, idpOrg } from "@server/db";
import { and, eq } from "drizzle-orm";
import { generateOidcRedirectUrl } from "@server/lib/idp/generateRedirectUrl";
import {
    buildOidcAuthorizationUrl,
    OIDC_STATE_COOKIE_NAME,
    OIDC_STATE_TTL_MS
} from "@server/lib/idp/buildOidcAuthorizationUrl";
import { build } from "@server/build";
import { isSubscribed } from "#dynamic/lib/isSubscribed";
import { tierMatrix } from "@server/lib/billing/tierMatrix";

const paramsSchema = z
    .object({
        idpId: z.coerce.number<number>()
    })
    .strict();

const bodySchema = z.strictObject({
    redirectUrl: z.string()
});

const querySchema = z.object({
    orgId: z.string().optional() // check what actuall calls it
});

export type GenerateOidcUrlResponse = {
    redirectUrl: string;
};

export async function generateOidcUrl(
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

        const { idpId } = parsedParams.data;

        const parsedBody = bodySchema.safeParse(req.body);
        if (!parsedBody.success) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    fromError(parsedBody.error).toString()
                )
            );
        }

        const { redirectUrl: postAuthRedirectUrl } = parsedBody.data;

        const parsedQuery = querySchema.safeParse(req.query);
        if (!parsedQuery.success) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    fromError(parsedQuery.error).toString()
                )
            );
        }

        const { orgId } = parsedQuery.data;

        const [existingIdp] = await db
            .select()
            .from(idp)
            .innerJoin(idpOidcConfig, eq(idpOidcConfig.idpId, idp.idpId))
            .where(and(eq(idp.type, "oidc"), eq(idp.idpId, idpId)));

        if (!existingIdp) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    "IdP not found for the organization"
                )
            );
        }

        if (orgId) {
            const [idpOrgLink] = await db
                .select()
                .from(idpOrg)
                .where(and(eq(idpOrg.idpId, idpId), eq(idpOrg.orgId, orgId)))
                .limit(1);

            if (!idpOrgLink) {
                return next(
                    createHttpError(
                        HttpCode.BAD_REQUEST,
                        "IdP not found for the organization"
                    )
                );
            }

            if (build === "saas") {
                const subscribed = await isSubscribed(
                    orgId,
                    tierMatrix.orgOidc
                );
                if (!subscribed) {
                    return next(
                        createHttpError(
                            HttpCode.FORBIDDEN,
                            "This organization's current plan does not support this feature."
                        )
                    );
                }
            }
        }

        const redirectUrl = await generateOidcRedirectUrl(idpId, orgId);
        const { url, stateJwt } = buildOidcAuthorizationUrl({
            existingIdp,
            redirectUrl,
            postAuthRedirectUrl
        });

        res.cookie(OIDC_STATE_COOKIE_NAME, stateJwt, {
            path: "/",
            httpOnly: true,
            secure: req.protocol === "https",
            expires: new Date(Date.now() + OIDC_STATE_TTL_MS),
            sameSite: "lax"
        });

        return response<GenerateOidcUrlResponse>(res, {
            data: {
                redirectUrl: url.toString()
            },
            success: true,
            error: false,
            message: "Idp auth url generated",
            status: HttpCode.CREATED
        });
    } catch (error) {
        logger.error(error);
        return next(
            createHttpError(HttpCode.INTERNAL_SERVER_ERROR, "An error occurred")
        );
    }
}
