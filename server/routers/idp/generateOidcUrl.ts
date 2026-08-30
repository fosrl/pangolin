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
import * as client from "openid-client";
import { generateOidcRedirectUrl } from "@server/lib/idp/generateRedirectUrl";
import jsonwebtoken from "jsonwebtoken";
import config from "@server/lib/config";
import { decrypt } from "@server/lib/crypto";
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

const ensureTrailingSlash = (url: string): string => {
    return url;
};

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

        const key = config.getRawConfig().server.secret!;

        const decryptedClientId = decrypt(
            existingIdp.idpOidcConfig.clientId,
            key
        );
        const decryptedClientSecret = decrypt(
            existingIdp.idpOidcConfig.clientSecret,
            key
        );

        const redirectUrl = await generateOidcRedirectUrl(idpId, orgId);
        logger.debug("OIDC client info", {
            decryptedClientId,
            decryptedClientSecret,
            redirectUrl
        });

        const authConfig: client.Configuration = await client.discovery(
            new URL(existingIdp.idpOidcConfig.discoveryUrl),
            decryptedClientId,
            decryptedClientSecret,
        );

        const codeVerifier = client.randomPKCECodeVerifier();
        const codeChallenge: string =
            await client.calculatePKCECodeChallenge(codeVerifier);
        const state: string = client.randomState();
        const nonce: string = client.randomNonce();

        const redirectTo: URL = client.buildAuthorizationUrl(authConfig, {
            redirect_uri: ensureTrailingSlash(redirectUrl),
            scope: existingIdp.idpOidcConfig.scopes,
            code_challenge: codeChallenge,
            code_challenge_method: "S256",
            state,
            nonce
        });

        const stateJwt = jsonwebtoken.sign(
            {
                redirectUrl: postAuthRedirectUrl, // TODO: validate that this is safe
                state,
                nonce,
                codeVerifier,
            },
            config.getRawConfig().server.secret!
        );

        res.cookie("p_oidc_state", stateJwt, {
            path: "/",
            httpOnly: true,
            secure: req.protocol === "https",
            expires: new Date(Date.now() + 60 * 10 * 1000),
            sameSite: "lax"
        });

        return response<GenerateOidcUrlResponse>(res, {
            data: {
                redirectUrl: redirectTo.toString()
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
