import crypto from "crypto";
import fs from "fs";
import path from "path";
import { APP_PATH } from "@server/lib/consts";
import logger from "@server/logger";

const AUTH_DIR = path.join(APP_PATH, "auth");
const PRIVATE_KEY_PATH = path.join(AUTH_DIR, "jwt_private.pem");
const PUBLIC_KEY_PATH = path.join(AUTH_DIR, "jwt_public.pem");

let cachedPrivateKey: crypto.KeyObject | null = null;
let cachedPublicKeyPem: string | null = null;

/**
 * Generate a new RSA keypair for JWT signing and save to disk.
 * Private key is stored with restricted permissions (0o600).
 * Public key is readable (0o644) and sent to Newt for local JWT verification.
 */
export function generateJwtKeypair(): {
    privateKey: crypto.KeyObject;
    publicKeyPem: string;
} {
    logger.info("Generating new RSA keypair for JWT signing...");

    const { publicKey, privateKey } = crypto.generateKeyPairSync("rsa", {
        modulusLength: 2048
    });

    const privateKeyPem = privateKey
        .export({ type: "pkcs8", format: "pem" })
        .toString();
    const publicKeyPem = publicKey
        .export({ type: "spki", format: "pem" })
        .toString();

    // Ensure auth directory exists
    if (!fs.existsSync(AUTH_DIR)) {
        fs.mkdirSync(AUTH_DIR, { recursive: true });
    }

    // Write keys with appropriate permissions
    fs.writeFileSync(PRIVATE_KEY_PATH, privateKeyPem, { mode: 0o600 });
    fs.writeFileSync(PUBLIC_KEY_PATH, publicKeyPem, { mode: 0o644 });

    logger.info("JWT keypair generated and saved to %s", AUTH_DIR);

    cachedPrivateKey = privateKey;
    cachedPublicKeyPem = publicKeyPem;

    return { privateKey, publicKeyPem };
}

/**
 * Load the JWT keypair from disk. Returns null if files don't exist.
 */
export function loadJwtKeypair(): {
    privateKey: crypto.KeyObject;
    publicKeyPem: string;
} | null {
    if (!fs.existsSync(PRIVATE_KEY_PATH) || !fs.existsSync(PUBLIC_KEY_PATH)) {
        return null;
    }

    try {
        const privateKeyPem = fs.readFileSync(PRIVATE_KEY_PATH, "utf-8");
        const publicKeyPem = fs.readFileSync(PUBLIC_KEY_PATH, "utf-8");

        const privateKey = crypto.createPrivateKey(privateKeyPem);

        cachedPrivateKey = privateKey;
        cachedPublicKeyPem = publicKeyPem;

        return { privateKey, publicKeyPem };
    } catch (err) {
        logger.error("Failed to load JWT keypair: %s", err);
        return null;
    }
}

/**
 * Ensure the JWT keypair exists. Load from disk or generate if missing.
 */
export function ensureJwtKeypair(): {
    privateKey: crypto.KeyObject;
    publicKeyPem: string;
} {
    const existing = loadJwtKeypair();
    if (existing) {
        logger.debug("JWT keypair loaded from %s", AUTH_DIR);
        return existing;
    }
    return generateJwtKeypair();
}

/**
 * Get the cached public key PEM string for sending to Newt.
 * Call ensureJwtKeypair() during startup before using this.
 */
export function getJwtPublicKeyPem(): string {
    if (cachedPublicKeyPem) {
        return cachedPublicKeyPem;
    }

    // Try loading from disk as fallback
    const loaded = loadJwtKeypair();
    if (loaded) {
        return loaded.publicKeyPem;
    }

    logger.warn("JWT public key not available — keypair not yet generated");
    return "";
}

/**
 * Get the cached private key for signing JWTs.
 * Call ensureJwtKeypair() during startup before using this.
 */
export function getJwtPrivateKey(): crypto.KeyObject | null {
    if (cachedPrivateKey) {
        return cachedPrivateKey;
    }

    // Try loading from disk as fallback
    const loaded = loadJwtKeypair();
    if (loaded) {
        return loaded.privateKey;
    }

    logger.warn("JWT private key not available — keypair not yet generated");
    return null;
}
