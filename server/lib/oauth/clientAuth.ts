import type { Request } from "express";
import { sha256 } from "@oslojs/crypto/sha2";
import { timingSafeEqual } from "crypto";
import jsonwebtoken from "jsonwebtoken";
import config from "@server/lib/config";
import { decrypt } from "@server/lib/crypto";
import { db, oauthClients } from "@server/db";
import { eq, InferSelectModel } from "drizzle-orm";
import type { JwtPayload } from "jsonwebtoken";
import { getIssuerUrl } from "@server/lib/oauth/issuer";
import { CLIENT_JWT_CLOCK_TOLERANCE_SECONDS, CLIENT_JWT_MAX_AGE_SECONDS } from "./lifetimes";

export type OAuthClientRecord = InferSelectModel<typeof oauthClients>;
export type OAuthClientWithSecret = OAuthClientRecord & { storedSecret: string };

export async function authenticateClient(req: Request): Promise<OAuthClientWithSecret> {
    if (getBodyValue(req.body, "client_assertion")) {
        return authenticateClientAssertion(req);
    } else if (req.headers.authorization) {
        return authenticateClientSecretBasic(req);
    } else if (getBodyValue(req.body, "client_secret")) {
        return authenticateClientSecretPost(req);
    }
    throw new Error("Missing client credentials");
}

async function authenticateClientAssertion(req: Request): Promise<OAuthClientWithSecret> {
    const assertion = getBodyValue(req.body, "client_assertion");
    const assertionType = getBodyValue(req, "client_assertion_type");
    const formClientId = getBodyValue(req.body, "client_id");
    if (!assertion) {
        throw new Error("client_secret_jwt: Missing client_assertion in request body");
    }

    if (
        assertionType !==
        "urn:ietf:params:oauth:client-assertion-type:jwt-bearer"
    ) {
        throw new Error(
            "client_secret_jwt: Unsupported or missing client_assertion_type"
        );
    }

    const decodedAssertion = jsonwebtoken.decode(assertion);
    if (!decodedAssertion || typeof decodedAssertion !== "object") {
        throw new Error("client_secret_jwt: not a valid JWT");
    }

    // RFC 7523, Section 3:
    // "The client MUST verify that the value of the iss (issuer) claim matches the value of the sub (subject) claim."
    if (decodedAssertion.iss !== decodedAssertion.sub ||
        typeof decodedAssertion.iss !== "string" ||
        typeof decodedAssertion.sub !== "string"
    ) {
        throw new Error("client_secret_jwt: iss and/or sub claims invalid");
    }
    const clientId = decodedAssertion.iss;

    // RFC 7521, Section 4.2:
    // "If present, the value of the client_id parameter MUST identify the same client as is identified by the client assertion."
    if (formClientId && formClientId !== clientId) {
        throw new Error("client_secret_jwt: client_id does not match client_assertion");
    }

    const client = await getClientWithSecret(clientId);
    if (!client) {
        throw new Error("client_secret_jwt: client not found");
    }

    try {
        const result = jsonwebtoken.verify(assertion, client.storedSecret, {
            algorithms: ["HS256"],
            maxAge: CLIENT_JWT_MAX_AGE_SECONDS,
            clockTolerance: CLIENT_JWT_CLOCK_TOLERANCE_SECONDS,
            audience: getIssuerUrl(),
            issuer: clientId,
            subject: clientId,
        }) as JwtPayload;

        if (!result || typeof result !== "object") {
            throw new Error("client_secret_jwt: failed to verify JWT");
        }
    } catch {
        throw new Error("client_secret_jwt: failed to verify JWT");
    }

    return client;
}

async function authenticateClientSecretPost(req: Request): Promise<OAuthClientWithSecret> {
    const clientId = getBodyValue(req.body, "client_id");
    const clientSecret = getBodyValue(req.body, "client_secret");

    if (!clientId || !clientSecret) {
        throw new Error("client_secret_post: Missing client_id or client_secret in request body");
    }

    const client = await getClientWithSecret(clientId);
    if (constantTimeEquals(clientSecret, client.storedSecret)) {
        return client;
    }
    throw new Error("client_secret_post: Invalid client credentials");
}

async function authenticateClientSecretBasic(req: Request): Promise<OAuthClientWithSecret> {
    const basicCredentials = parseBasicAuth(req?.headers?.authorization ?? "");
    const client = await getClientWithSecret(basicCredentials.clientId);
    if (constantTimeEquals(basicCredentials.clientSecret, client.storedSecret)) {
        return client;
    }
    throw new Error("client_secret_basic: Invalid client credentials");
}

async function getClientWithSecret(clientId: string): Promise<OAuthClientWithSecret> {
    const [client] = await db
        .select()
        .from(oauthClients)
        .where(eq(oauthClients.clientId, clientId))
        .limit(1) as OAuthClientWithSecret[];

    if (!client || !client.enabled || !client.clientSecret) {
        throw new Error("Client not found or disabled");
    }

    client.storedSecret = decrypt(
        client.clientSecret,
        config.getRawConfig().server.secret!
    );

    if (!client.storedSecret) {
        throw new Error("Failed to decrypt client secret");
    }

    return client;
}

export function getBodyValue(body: unknown, key: string): string | undefined {
    const bodyRecord = body as Record<string, unknown>;

    if (!bodyRecord || typeof bodyRecord !== "object") {
        return undefined;
    }

    const value = bodyRecord[key];
    return typeof value === "string" ? value : undefined;
}

export function parseBasicAuth(header: string): { clientId: string; clientSecret: string } {
    const parts = header?.split(" ");
    if (!parts || parts.length !== 2 || parts[0] !== "Basic") {
        throw new Error("Invalid or missing Basic Authorization header");
    }

    try {
        const decoded = Buffer.from(parts[1], "base64").toString("utf8");
        const separatorIndex = decoded.indexOf(":");
        if (separatorIndex === -1) {
            throw new Error("Invalid Basic Authorization header format");
        }

        return {
            clientId: decodeURIComponent(decoded.slice(0, separatorIndex)),
            clientSecret: decodeURIComponent(decoded.slice(separatorIndex + 1))
        };
    } catch {
        throw new Error("Failed to parse Basic Authorization header");
    }
}

export function constantTimeEquals(candidate: string, expected: string): boolean {
    // Hashing both sides first makes the comparison inputs uniformly 32 bytes, so
    // wrong-length (attacker-controlled) input can never make timingSafeEqual throw.
    return timingSafeEqual(
        sha256(new TextEncoder().encode(candidate)),
        sha256(new TextEncoder().encode(expected))
    );
}
