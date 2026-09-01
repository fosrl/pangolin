import { canUserAccessResource } from "@server/auth/canUserAccessResource";
import {
    db,
    users,
    virtualApiKeyResources,
    virtualApiKeys,
    type VirtualApiKey
} from "@server/db";
import config from "@server/lib/config";
import {
    decryptVirtualApiKeyToken,
    VIRTUAL_API_KEY_PREFIX,
    looksLikeVirtualApiKeyCredential
} from "@server/lib/virtualApiKey";
import { getUserOrgRoles } from "@server/lib/userOrgRoles";
import { and, eq } from "drizzle-orm";
import { isWithinExpirationDate } from "oslo";

export type VirtualApiKeyCredential = {
    virtualApiKeyId: string;
    secret: string;
};

export type VirtualApiKeyUserData = {
    userId: string;
    username: string;
    email: string | null;
    name: string | null;
    role: string | null;
};

function getHeader(
    headers: Record<string, string> | undefined,
    name: string
): string | undefined {
    if (!headers) {
        return undefined;
    }
    if (headers[name] !== undefined) {
        return headers[name];
    }
    const lower = name.toLowerCase();
    for (const [key, value] of Object.entries(headers)) {
        if (key.toLowerCase() === lower) {
            return value;
        }
    }
    return undefined;
}

function parseVkCredential(
    raw: string | undefined
): VirtualApiKeyCredential | null {
    if (!raw || !looksLikeVirtualApiKeyCredential(raw)) {
        return null;
    }
    const withoutPrefix = raw.trim().slice(VIRTUAL_API_KEY_PREFIX.length);
    const dot = withoutPrefix.indexOf(".");
    return {
        virtualApiKeyId: withoutPrefix.slice(0, dot),
        secret: withoutPrefix.slice(dot + 1)
    };
}

export function extractVirtualApiKeyCredential(
    headers: Record<string, string> | undefined
): VirtualApiKeyCredential | null {
    if (!headers) {
        return null;
    }

    const authorization = getHeader(headers, "authorization");
    if (authorization) {
        const bearerMatch = authorization.match(/^Bearer\s+(.+)$/i);
        if (bearerMatch) {
            const credential = parseVkCredential(bearerMatch[1]);
            if (credential) {
                return credential;
            }
        }
        const splunkMatch = authorization.match(/^Splunk\s+(.+)$/i);
        if (splunkMatch) {
            const credential = parseVkCredential(splunkMatch[1]);
            if (credential) {
                return credential;
            }
        }
    }

    const cfAig = getHeader(headers, "cf-aig-authorization");
    if (cfAig) {
        const bearerMatch = cfAig.match(/^Bearer\s+(.+)$/i);
        const credential = parseVkCredential(
            bearerMatch ? bearerMatch[1] : cfAig
        );
        if (credential) {
            return credential;
        }
    }

    for (const name of ["x-api-key", "x-goog-api-key"] as const) {
        const credential = parseVkCredential(getHeader(headers, name));
        if (credential) {
            return credential;
        }
    }

    return null;
}

async function buildUserData(
    userId: string,
    orgId: string
): Promise<VirtualApiKeyUserData | undefined> {
    const [user] = await db
        .select()
        .from(users)
        .where(eq(users.userId, userId))
        .limit(1);

    if (!user) {
        return undefined;
    }

    if (
        config.getRawConfig().flags?.require_email_verification &&
        !user.emailVerified
    ) {
        return undefined;
    }

    const userOrgRoles = await getUserOrgRoles(user.userId, orgId);
    if (userOrgRoles.length === 0) {
        return undefined;
    }

    return {
        userId: user.userId,
        username: user.username,
        email: user.email,
        name: user.name,
        role: userOrgRoles.map((r) => r.roleName).join(", ") || null
    };
}

async function userHasResourceAccess(
    userId: string,
    resourceId: number,
    orgId: string
): Promise<{ allowed: boolean; userData?: VirtualApiKeyUserData }> {
    const [user] = await db
        .select()
        .from(users)
        .where(eq(users.userId, userId))
        .limit(1);

    if (!user) {
        return { allowed: false };
    }

    if (
        config.getRawConfig().flags?.require_email_verification &&
        !user.emailVerified
    ) {
        return { allowed: false };
    }

    const userOrgRoles = await getUserOrgRoles(user.userId, orgId);
    if (userOrgRoles.length === 0) {
        return { allowed: false };
    }

    const allowed = await canUserAccessResource({
        userId,
        resourceId,
        roleIds: userOrgRoles.map((r) => r.roleId)
    });

    if (!allowed) {
        return { allowed: false };
    }

    return {
        allowed: true,
        userData: {
            userId: user.userId,
            username: user.username,
            email: user.email,
            name: user.name,
            role: userOrgRoles.map((r) => r.roleName).join(", ") || null
        }
    };
}

async function manualKeyHasResourceAccess(
    key: VirtualApiKey,
    resourceId: number
): Promise<boolean> {
    if (key.allResources) {
        return true;
    }

    const [row] = await db
        .select({ resourceId: virtualApiKeyResources.resourceId })
        .from(virtualApiKeyResources)
        .where(
            and(
                eq(virtualApiKeyResources.virtualApiKeyId, key.virtualApiKeyId),
                eq(virtualApiKeyResources.resourceId, resourceId)
            )
        )
        .limit(1);

    return Boolean(row);
}

async function touchLastUsedAt(virtualApiKeyId: string): Promise<void> {
    try {
        await db
            .update(virtualApiKeys)
            .set({ lastUsedAt: Date.now() })
            .where(eq(virtualApiKeys.virtualApiKeyId, virtualApiKeyId));
    } catch {
        // Best-effort; do not fail auth on audit timestamp updates.
    }
}

export async function verifyVirtualApiKey({
    credential,
    resourceId,
    orgId
}: {
    credential: VirtualApiKeyCredential;
    resourceId: number;
    orgId: string;
}): Promise<{
    valid: boolean;
    error?: string;
    key?: VirtualApiKey;
    userData?: VirtualApiKeyUserData;
}> {
    const [key] = await db
        .select()
        .from(virtualApiKeys)
        .where(eq(virtualApiKeys.virtualApiKeyId, credential.virtualApiKeyId))
        .limit(1);

    if (!key) {
        return { valid: false, error: "Virtual API key not found" };
    }

    if (key.orgId !== orgId) {
        return { valid: false, error: "Virtual API key org mismatch" };
    }

    let plaintext: string;
    try {
        plaintext = decryptVirtualApiKeyToken(key.token);
    } catch {
        return { valid: false, error: "Virtual API key secret is invalid" };
    }

    if (plaintext !== credential.secret) {
        return { valid: false, error: "Invalid virtual API key secret" };
    }

    if (key.expiresAt && !isWithinExpirationDate(new Date(key.expiresAt))) {
        return { valid: false, error: "Virtual API key has expired" };
    }

    if (key.kind === "manual") {
        const scoped = await manualKeyHasResourceAccess(key, resourceId);
        if (!scoped) {
            return {
                valid: false,
                error: "Virtual API key is not scoped to this resource"
            };
        }

        let userData: VirtualApiKeyUserData | undefined;
        if (key.userId) {
            userData = await buildUserData(key.userId, orgId);
        }

        await touchLastUsedAt(key.virtualApiKeyId);
        return { valid: true, key, userData };
    }

    if (key.kind === "user") {
        if (!key.userId) {
            return { valid: false, error: "User virtual API key has no user" };
        }

        const access = await userHasResourceAccess(
            key.userId,
            resourceId,
            orgId
        );
        if (!access.allowed || !access.userData) {
            return {
                valid: false,
                error: "User is not allowed to access this resource"
            };
        }

        await touchLastUsedAt(key.virtualApiKeyId);
        return { valid: true, key, userData: access.userData };
    }

    return { valid: false, error: "Unknown virtual API key kind" };
}
