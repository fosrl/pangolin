type EncryptedStorageEnvelope = {
    v: 1;
    s: string;
    i: string;
    d: string;
};

const PBKDF2_ITERATIONS = 120000;

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
    return bytes.buffer.slice(
        bytes.byteOffset,
        bytes.byteOffset + bytes.byteLength
    ) as ArrayBuffer;
}

function bytesToBase64(bytes: Uint8Array): string {
    let binary = "";
    for (const byte of bytes) {
        binary += String.fromCharCode(byte);
    }
    return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array {
    const binary = atob(value);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
}

async function deriveKey(authToken: string, salt: ArrayBuffer) {
    const subtle = window.crypto?.subtle;
    if (!subtle) {
        throw new Error("Web Crypto is unavailable");
    }

    const tokenKey = await subtle.importKey(
        "raw",
        toArrayBuffer(new TextEncoder().encode(authToken)),
        "PBKDF2",
        false,
        ["deriveKey"]
    );

    return subtle.deriveKey(
        {
            name: "PBKDF2",
            salt,
            iterations: PBKDF2_ITERATIONS,
            hash: "SHA-256"
        },
        tokenKey,
        { name: "AES-GCM", length: 256 },
        false,
        ["encrypt", "decrypt"]
    );
}

export async function saveEncryptedLocalStorage<T>(
    storageKey: string,
    value: T,
    authToken: string | null | undefined
) {
    if (typeof window === "undefined") return;
    if (!authToken) {
        window.localStorage.removeItem(storageKey);
        return;
    }

    const salt = window.crypto.getRandomValues(new Uint8Array(16));
    const iv = window.crypto.getRandomValues(new Uint8Array(12));
    const key = await deriveKey(authToken, toArrayBuffer(salt));
    const plaintext = new TextEncoder().encode(JSON.stringify(value));
    const encrypted = await window.crypto.subtle.encrypt(
        { name: "AES-GCM", iv: toArrayBuffer(iv) },
        key,
        toArrayBuffer(plaintext)
    );

    const payload: EncryptedStorageEnvelope = {
        v: 1,
        s: bytesToBase64(salt),
        i: bytesToBase64(iv),
        d: bytesToBase64(new Uint8Array(encrypted))
    };

    window.localStorage.setItem(storageKey, JSON.stringify(payload));
}

export async function loadEncryptedLocalStorage<T>(
    storageKey: string,
    authToken: string | null | undefined
): Promise<T | null> {
    if (typeof window === "undefined") return null;
    if (!authToken) return null;

    const raw = window.localStorage.getItem(storageKey);
    if (!raw) return null;

    try {
        const payload = JSON.parse(raw) as EncryptedStorageEnvelope;
        if (payload.v !== 1 || !payload.s || !payload.i || !payload.d) {
            throw new Error("Invalid encrypted payload");
        }

        const salt = base64ToBytes(payload.s);
        const iv = base64ToBytes(payload.i);
        const data = base64ToBytes(payload.d);
        const key = await deriveKey(authToken, toArrayBuffer(salt));
        const decrypted = await window.crypto.subtle.decrypt(
            { name: "AES-GCM", iv: toArrayBuffer(iv) },
            key,
            toArrayBuffer(data)
        );
        const json = new TextDecoder().decode(decrypted);
        return JSON.parse(json) as T;
    } catch {
        window.localStorage.removeItem(storageKey);
        return null;
    }
}
