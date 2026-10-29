import type {
    DirectoryFetchContext,
    DirectoryFetchResult,
    DirectorySyncProvider,
    DirectoryUser
} from "./types";
import { ensureValidIdp, type IdpDbResponse } from "./ensureValidIdp";

import { createSign } from "node:crypto";
import cache from "@server/lib/cache";
import logger from "@server/logger";
import { decryptDirectorySyncConfig } from "./config";
import z from "zod";
import { googleDirectorySyncConfigSchema } from "@app/lib/idpDirectorySyncConfig";
import { fromError } from "zod-validation-error";

type ServiceAccountKey = {
    client_email: string;
    private_key: string;
    token_uri: string; // https://oauth2.googleapis.com/token
};

const serviceAccountKeySchema = z.object({
    client_email: z.email(),
    private_key: z.string(),
    token_uri: z.url()
});

const SCOPES = [
    "https://www.googleapis.com/auth/admin.directory.user.readonly",
    "https://www.googleapis.com/auth/admin.directory.group.readonly",
    "https://www.googleapis.com/auth/admin.directory.group.member.readonly"
].join(" ");

function b64url(input: string | Buffer) {
    return Buffer.from(input).toString("base64url");
}

const tokenBodySchema = z.object({
    expires_in: z.int(),
    access_token: z.string()
});

export class AzureDirectorySyncProvider implements DirectorySyncProvider {
    #TOKEN_CACHE_KEY_PREFIX = "googleDirectorySyncToken";
    #googleAPIBaseUrl = "https://admin.googleapis.com/admin/directory/v1";

    async fetch(ctx: DirectoryFetchContext): Promise<DirectoryFetchResult> {
        const directoryUsers: Record<string, DirectoryUser> = {};
        // 0. fetch idp and check that it is valid
        const idpRes = await ensureValidIdp(ctx.idpId, "google");

        // 1. get access token (and cache)
        const token = await this.#getToken(idpRes);

        throw new Error("Method not implemented.");
    }

    async #getToken(idpRes: IdpDbResponse): Promise<string> {
        const cacheKey = `${this.#TOKEN_CACHE_KEY_PREFIX}:${idpRes.idp.idpId}`;
        const cached = await cache.get<string>(cacheKey);

        if (cached) {
            logger.info("Returning cached access token");
            return cached;
        }

        logger.info("Fetching fresh access token");
        let directorySyncConfig;
        try {
            directorySyncConfig = googleDirectorySyncConfigSchema.parse(
                decryptDirectorySyncConfig(idpRes.idp.directorySyncConfig!)
            );
        } catch (e) {
            throw new Error(
                `Directory sync: unexpected Entra token response for IdP ${idpRes.idp.idpId}: ${fromError(e).toString()}`,
                { cause: e }
            );
        }

        const key = directorySyncConfig.serviceAccountKey;

        const now = Math.floor(Date.now() / 1000);
        const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
        const claims = b64url(
            JSON.stringify({
                iss: key.client_email,
                sub: directorySyncConfig.adminEmail, // only with domain-wide delegation
                scope: SCOPES,
                aud: key.token_uri,
                iat: now,
                exp: now + 3600 // max 1h
            })
        );
        const signature = createSign("RSA-SHA256")
            .update(`${header}.${claims}`)
            .sign(key.private_key, "base64url");

        const res = await fetch(key.token_uri, {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({
                grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
                assertion: `${header}.${claims}.${signature}`
            })
        });
        const body: any = await res.json().catch(() => ({}));
        if (!res.ok) {
            const reason =
                body.error_description ??
                body.error ??
                res.statusText ??
                "no error details in response";
            throw new Error(
                `Directory sync: Google Workspace token request for IdP ${idpRes.idp.idpId} failed (HTTP ${res.status}): ${reason}`
            );
        }

        try {
            const tokenResponse = tokenBodySchema.parse(body);
            await cache.set(
                cacheKey,
                tokenResponse.access_token,
                tokenResponse.expires_in - 30 // keep the response 30 seconds less than the token to make sure to always have a fresh token
            );

            logger.info(
                `Got new access token (expires in: ${tokenResponse.expires_in}s)`
            );

            return tokenResponse.access_token;
        } catch (e) {
            throw new Error(
                `Directory sync: unexpected Google Workspace token response for IdP ${idpRes.idp.idpId}: ${fromError(e).toString()}`,
                { cause: e }
            );
        }
    }
}
