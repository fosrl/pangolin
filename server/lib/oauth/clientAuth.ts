import type { Request, Response } from "express";
import { eq } from "drizzle-orm";
import { verifyPassword } from "@server/auth/password";
import { db, oauthClients } from "@server/db";
import HttpCode from "@server/types/HttpCode";

type OAuthClientRecord = typeof oauthClients.$inferSelect;

export type OAuthError = {
    error: string;
    error_description: string;
};

export function getBodyValue(body: unknown, key: string): string | undefined {
    if (!body || typeof body !== "object") {
        return undefined;
    }

    const value = Reflect.get(body, key);

    if (typeof value === "string") {
        return value;
    }

    if (
        Array.isArray(value) &&
        value.length > 0 &&
        typeof value[0] === "string"
    ) {
        return value[0];
    }

    return undefined;
}

export function sendOAuthError(
    res: Response,
    status: number,
    oauthError: OAuthError
): void {
    res.status(status).json(oauthError);
}

export function parseBasicAuth(
    authorizationHeader: string | undefined
): { clientId: string; clientSecret: string } | null {
    if (!authorizationHeader || !authorizationHeader.startsWith("Basic ")) {
        return null;
    }

    try {
        const decoded = Buffer.from(
            authorizationHeader.slice("Basic ".length),
            "base64"
        ).toString("utf8");
        const separatorIndex = decoded.indexOf(":");

        if (separatorIndex < 0) {
            return null;
        }

        return {
            clientId: decodeURIComponent(decoded.slice(0, separatorIndex)),
            clientSecret: decodeURIComponent(decoded.slice(separatorIndex + 1))
        };
    } catch {
        return null;
    }
}

export async function authenticateClient(
    req: Request
): Promise<
    { client: OAuthClientRecord } | { status: number; oauthError: OAuthError }
> {
    const basicCredentials = parseBasicAuth(req.headers.authorization);

    const clientId =
        basicCredentials?.clientId || getBodyValue(req.body, "client_id");
    const clientSecret =
        basicCredentials?.clientSecret ||
        getBodyValue(req.body, "client_secret");

    if (!clientId) {
        return {
            status: HttpCode.UNAUTHORIZED,
            oauthError: {
                error: "invalid_client",
                error_description: "Missing client_id"
            }
        };
    }

    const [client] = await db
        .select()
        .from(oauthClients)
        .where(eq(oauthClients.clientId, clientId))
        .limit(1);

    if (!client || !client.enabled) {
        return {
            status: HttpCode.UNAUTHORIZED,
            oauthError: {
                error: "invalid_client",
                error_description: "Invalid client credentials"
            }
        };
    }

    if (!client.clientSecretHash) {
        return {
            status: HttpCode.UNAUTHORIZED,
            oauthError: {
                error: "invalid_client",
                error_description: "Invalid client configuration"
            }
        };
    }

    if (!clientSecret) {
        return {
            status: HttpCode.UNAUTHORIZED,
            oauthError: {
                error: "invalid_client",
                error_description: "Missing client_secret"
            }
        };
    }

    const validSecret = await verifyPassword(
        clientSecret,
        client.clientSecretHash
    );
    if (!validSecret) {
        return {
            status: HttpCode.UNAUTHORIZED,
            oauthError: {
                error: "invalid_client",
                error_description: "Invalid client credentials"
            }
        };
    }

    return { client };
}
