import { createPublicKey, generateKeyPairSync } from "crypto";
import { db, oauthSigningKeys } from "@server/db";
import { eq, desc } from "drizzle-orm";
import { encrypt, decrypt } from "@server/lib/crypto";
import config from "@server/lib/config";
import { generateIdFromEntropySize } from "@server/auth/sessions/app";

function getEncryptionKey(): string {
    const key = config.getRawConfig().server.secret;
    if (!key) {
        throw new Error(
            "Missing server secret for OAuth signing key encryption"
        );
    }
    return key;
}

async function selectActiveSigningKeys() {
    return db
        .select()
        .from(oauthSigningKeys)
        .where(eq(oauthSigningKeys.active, true))
        .orderBy(desc(oauthSigningKeys.createdAt));
}

export async function ensureSigningKey(): Promise<void> {
    const [existingKey] = await selectActiveSigningKeys();

    if (existingKey) {
        return;
    }

    const keyPair = generateKeyPairSync("rsa", {
        modulusLength: 2048,
        publicKeyEncoding: {
            type: "spki",
            format: "pem"
        },
        privateKeyEncoding: {
            type: "pkcs8",
            format: "pem"
        }
    });

    const createdAt = Date.now();

    await db.insert(oauthSigningKeys).values({
        keyId: generateIdFromEntropySize(10),
        algorithm: "RS256",
        publicKeyPem: keyPair.publicKey,
        privateKeyPem: encrypt(keyPair.privateKey, getEncryptionKey()),
        active: true,
        createdAt
    });
}

export async function getActiveSigningKey(): Promise<{
    keyId: string;
    algorithm: string;
    publicKeyPem: string;
    privateKeyPem: string;
}> {
    const [activeKey] = await selectActiveSigningKeys();

    if (!activeKey) {
        throw new Error("No active OAuth signing key found");
    }

    return {
        keyId: activeKey.keyId,
        algorithm: activeKey.algorithm,
        publicKeyPem: activeKey.publicKeyPem,
        privateKeyPem: decrypt(activeKey.privateKeyPem, getEncryptionKey())
    };
}

export async function getActiveSigningPublicKeys(): Promise<
    {
        keyId: string;
        algorithm: string;
        publicKeyPem: string;
    }[]
> {
    const activeKeys = await selectActiveSigningKeys();

    return activeKeys.map((key) => ({
        keyId: key.keyId,
        algorithm: key.algorithm,
        publicKeyPem: key.publicKeyPem
    }));
}

export async function getJWKS(): Promise<JsonWebKey[]> {
    const activeKeys = await selectActiveSigningKeys();

    return activeKeys.map((key) => {
        const exported = createPublicKey(key.publicKeyPem).export({
            format: "jwk"
        });

        if (typeof exported === "string" || exported instanceof Uint8Array) {
            throw new Error("Invalid JWK export format");
        }

        return {
            ...exported,
            kid: key.keyId,
            alg: "RS256",
            use: "sig"
        };
    });
}
