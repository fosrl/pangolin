import { createPublicKey, generateKeyPairSync } from "crypto";
import { db, OauthSigningKey, oauthSigningKeys } from "@server/db";
import { eq, desc } from "drizzle-orm";
import { encrypt, decrypt } from "@server/lib/crypto";
import config from "@server/lib/config";
import { generateIdFromEntropySize } from "@server/auth/sessions/app";

// A signing key whose privateKeyPem holds the **decrypted** PEM.
export type OAuthDecryptedSigningKey = OauthSigningKey;

// A signing key that shall not leak **any** form of the private key PEM.
export type OAuthPublicSigningKey = Omit<OauthSigningKey, "privateKeyPem">;

function toPublicSigningKey(key: OauthSigningKey): OAuthPublicSigningKey {
    const { privateKeyPem, ...publicKey } = key;
    return publicKey;
}

function getEncryptionKey(): string {
    const key = config.getRawConfig().server.secret;
    if (!key) {
        throw new Error(
            "Missing server secret for OAuth signing key encryption"
        );
    }
    return key;
}

async function selectActiveSigningKeys(): Promise<OauthSigningKey[]> {
    return db
        .select()
        .from(oauthSigningKeys)
        .where(eq(oauthSigningKeys.active, true))
        .orderBy(desc(oauthSigningKeys.createdAt));
}

export async function ensureSigningKey(): Promise<OAuthPublicSigningKey> {
    const [existingKey] = await selectActiveSigningKeys();
    return existingKey ? toPublicSigningKey(existingKey) : createSigningKey();
}

export async function createSigningKey(): Promise<OAuthPublicSigningKey> {
    const keyPair = generateKeyPairSync("rsa", {
        modulusLength: 4096,
        publicKeyEncoding: {
            type: "spki",
            format: "pem"
        },
        privateKeyEncoding: {
            type: "pkcs8",
            format: "pem"
        }
    });

    const key: OauthSigningKey = {
        keyId: generateIdFromEntropySize(10),
        algorithm: "RS256",
        publicKeyPem: keyPair.publicKey,
        privateKeyPem: encrypt(keyPair.privateKey, getEncryptionKey()),
        active: true,
        createdAt: Date.now()
    };

    await db.insert(oauthSigningKeys).values(key);
    return toPublicSigningKey(key);
}

export async function getActiveSigningKey(): Promise<OAuthDecryptedSigningKey> {
    // TODO: Currently, the system only supports a single active signing key at a time.
    const [activeKey] = await selectActiveSigningKeys();

    if (!activeKey) {
        // TODO: Implement key rotation
        throw new Error("No active OAuth signing key found");
    }

    const privateKeyPem = decrypt(activeKey.privateKeyPem, getEncryptionKey());
    if (!privateKeyPem) {
        // TODO: Implement expiration logic for signing keys
        // The secret is no longer valid, but the rotation has not re-encrypted the key
        throw new Error("Failed to decrypt the private key");
    }

    return { ...activeKey, privateKeyPem };
}

export async function getActiveSigningPublicKeys(): Promise<
    OAuthPublicSigningKey[]
> {
    const activeKeys = await selectActiveSigningKeys();
    return activeKeys.map(toPublicSigningKey);
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
