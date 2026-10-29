import type {
    DirectoryFetchContext,
    DirectoryFetchResult,
    DirectorySyncProvider,
    DirectoryUser
} from "./types";
import { ensureValidIdp } from "./ensureValidIdp";

import { createSign } from "node:crypto";

type ServiceAccountKey = {
    client_email: string;
    private_key: string;
    token_uri: string; // https://oauth2.googleapis.com/token
};

const SCOPES = [
    "https://www.googleapis.com/auth/admin.directory.user.readonly",
    "https://www.googleapis.com/auth/admin.directory.group.readonly",
    "https://www.googleapis.com/auth/admin.directory.group.member.readonly"
].join(" ");

function b64url(input: string | Buffer) {
    return Buffer.from(input).toString("base64url");
}

export class AzureDirectorySyncProvider implements DirectorySyncProvider {
    #TOKEN_CACHE_KEY_PREFIX = "googleDirectorySyncToken";
    #googleAPIBaseUrl = "https://admin.googleapis.com/admin/directory/v1";

    async fetch(ctx: DirectoryFetchContext): Promise<DirectoryFetchResult> {
        const directoryUsers: Record<string, DirectoryUser> = {};
        // 0. fetch idp and check that it is valid
        const idpRes = await ensureValidIdp(ctx.idpId, "google");
        throw new Error("Method not implemented.");
    }

    async #getGoogleAccessToken(key: ServiceAccountKey, adminEmail?: string) {
        const now = Math.floor(Date.now() / 1000);
        const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
        const claims = b64url(
            JSON.stringify({
                iss: key.client_email,
                sub: adminEmail, // only with domain-wide delegation
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
        if (!res.ok) throw new Error(`Google token error: ${await res.text()}`);
        return (await res.json()) as {
            access_token: string;
            expires_in: number;
        };
    }
}
