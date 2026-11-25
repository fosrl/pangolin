import { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { db, idp, idpOidcConfig, resources, targets } from "@server/db";
import response from "@server/lib/response";
import HttpCode from "@server/types/HttpCode";
import createHttpError from "http-errors";
import logger from "@server/logger";
import { fromError } from "zod-validation-error";
import { and, eq } from "drizzle-orm";
import * as arctic from "arctic";
import jsonwebtoken from "jsonwebtoken";
import config from "@server/lib/config";
import { decrypt } from "@server/lib/crypto";
import {
    ENTRA_DEVICE_LIST_SCOPE,
    isEntraAuthority,
    isValidEntraDeviceName,
    rdpEntraRedirectUrl,
    rdpEntraScope
} from "@server/lib/idp/entraRdp";

const paramsSchema = z
    .object({
        idpId: z.coerce.number<number>()
    })
    .strict();

const bodySchema = z.discriminatedUnion("purpose", [
    z.strictObject({
        purpose: z.literal("token"),
        deviceName: z.string().min(1).max(63),
        // Proof-of-possession binding computed by the RDP client for its key
        reqCnf: z.string().min(1).max(512),
        // Origin of the browser RDP page that receives the token
        origin: z.string().url()
    }),
    z.strictObject({
        purpose: z.literal("devices"),
        origin: z.string().url()
    })
]);

export const RDP_ENTRA_STATE_PURPOSE = "rdp-entra";
export const RDP_ENTRA_DEVICES_STATE_PURPOSE = "rdp-entra-devices";

export type RdpEntraState = {
    purpose:
        typeof RDP_ENTRA_STATE_PURPOSE | typeof RDP_ENTRA_DEVICES_STATE_PURPOSE;
    idpId: number;
    state: string;
    codeVerifier: string;
    reqCnf: string;
    deviceName: string;
    origin: string;
};

export type GenerateRdpEntraUrlResponse = {
    redirectUrl: string;
};

/**
 * Builds the Entra authorization URL for RDP sign-in to one host.
 *
 * The flow is started by the dashboard-domain page that the RDP client opens
 * in a popup, so the resulting token can be posted back to the RDP page.
 */
export async function generateRdpEntraUrl(
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

        const { idpId } = parsedParams.data;
        const body = parsedBody.data;
        const { origin } = body;
        const listDevices = body.purpose === "devices";
        const deviceName = body.purpose === "token" ? body.deviceName : "";
        const reqCnf = body.purpose === "token" ? body.reqCnf : "";

        if (!listDevices && !isValidEntraDeviceName(deviceName)) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    "Invalid Entra device name"
                )
            );
        }

        // Only a browser RDP page served by this instance may receive tokens;
        // otherwise any site could trick a user into minting one for it.
        const originUrl = new URL(origin);
        // The dashboard may only list devices, for the resource settings.
        const isDashboardOrigin =
            listDevices &&
            originUrl.origin ===
                new URL(config.getRawConfig().app.dashboard_url!).origin;
        const [rdpResource] = await db
            .select({ resourceId: resources.resourceId })
            .from(resources)
            .innerJoin(targets, eq(targets.resourceId, resources.resourceId))
            .where(
                and(
                    eq(resources.fullDomain, originUrl.hostname),
                    eq(targets.mode, "rdp")
                )
            )
            .limit(1);

        if (!rdpResource && !isDashboardOrigin) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    "Origin is not a browser RDP resource"
                )
            );
        }

        const [existingIdp] = await db
            .select()
            .from(idp)
            .innerJoin(idpOidcConfig, eq(idpOidcConfig.idpId, idp.idpId))
            .where(and(eq(idp.type, "oidc"), eq(idp.idpId, idpId)));

        if (!existingIdp) {
            return next(createHttpError(HttpCode.NOT_FOUND, "IdP not found"));
        }

        if (!isEntraAuthority(existingIdp.idpOidcConfig.authUrl)) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    "IdP is not a Microsoft Entra ID provider"
                )
            );
        }

        const key = config.getRawConfig().server.secret!;
        const clientId = decrypt(existingIdp.idpOidcConfig.clientId, key);
        const clientSecret = decrypt(
            existingIdp.idpOidcConfig.clientSecret,
            key
        );

        const client = new arctic.OAuth2Client(
            clientId,
            clientSecret,
            rdpEntraRedirectUrl(idpId)
        );

        const codeVerifier = arctic.generateCodeVerifier();
        const state = arctic.generateState();

        const statePayload: RdpEntraState = {
            purpose: listDevices
                ? RDP_ENTRA_DEVICES_STATE_PURPOSE
                : RDP_ENTRA_STATE_PURPOSE,
            idpId,
            state,
            codeVerifier,
            reqCnf,
            deviceName,
            origin: originUrl.origin
        };

        // Everything the callback needs travels in the signed state, so the
        // popup needs no cookie from the RDP page's origin.
        const stateJwt = jsonwebtoken.sign(statePayload, key, {
            expiresIn: "10m"
        });

        const url = client.createAuthorizationURLWithPKCE(
            existingIdp.idpOidcConfig.authUrl,
            stateJwt,
            arctic.CodeChallengeMethod.S256,
            codeVerifier,
            [listDevices ? ENTRA_DEVICE_LIST_SCOPE : rdpEntraScope(deviceName)]
        );

        return response<GenerateRdpEntraUrlResponse>(res, {
            data: {
                redirectUrl: url.toString()
            },
            success: true,
            error: false,
            message: "Entra RDP sign-in URL generated",
            status: HttpCode.CREATED
        });
    } catch (error) {
        logger.error(error);
        return next(
            createHttpError(
                HttpCode.INTERNAL_SERVER_ERROR,
                "An error occurred while generating the sign-in URL"
            )
        );
    }
}
