import {
    generateId,
    generateIdFromEntropySize
} from "@server/auth/sessions/app";
import {
    db,
    resources,
    User,
    virtualApiKeyResources,
    virtualApiKeys,
    type Transaction,
    type VirtualApiKey
} from "@server/db";
import config from "@server/lib/config";
import { decrypt, encrypt } from "@server/lib/crypto";
import { and, eq, inArray } from "drizzle-orm";

export {
    VIRTUAL_API_KEY_PREFIX,
    formatVirtualApiKeyCredential,
    formatVirtualApiKeyPreview,
    looksLikeVirtualApiKeyCredential,
    stripVirtualApiKeyAuthHeaders
} from "@app/lib/virtualApiKeyFormat";

export type MintedVirtualApiKeySecret = {
    virtualApiKeyId: string;
    secret: string;
    lastChars: string;
};

export type PublicVirtualApiKey = Omit<VirtualApiKey, "token"> & {
    secret?: string;
};

export function mintVirtualApiKeySecret(): MintedVirtualApiKeySecret {
    const secret = generateIdFromEntropySize(16);
    return {
        virtualApiKeyId: generateId(8),
        secret,
        lastChars: secret.slice(-4)
    };
}

export function encryptVirtualApiKeyToken(secret: string): string {
    return encrypt(secret, config.getRawConfig().server.secret!);
}

export function decryptVirtualApiKeyToken(ciphertext: string): string {
    return decrypt(ciphertext, config.getRawConfig().server.secret!);
}

export function toPublicVirtualApiKey(
    row: VirtualApiKey,
    options?: { includeSecret?: boolean }
): PublicVirtualApiKey {
    const { token, ...rest } = row;
    if (!options?.includeSecret) {
        return rest;
    }
    return {
        ...rest,
        secret: decryptVirtualApiKeyToken(token)
    };
}

export async function assertManualKeyResourcesInOrg(params: {
    allResources: boolean;
    resourceIds: number[];
    orgId: string;
}): Promise<{ ok: true } | { ok: false; message: string }> {
    const { allResources, resourceIds, orgId } = params;

    if (allResources) {
        return { ok: true };
    }

    if (resourceIds.length === 0) {
        return {
            ok: false,
            message:
                "Select at least one public inference resource, or enable all public inference resources"
        };
    }

    const uniqueIds = [...new Set(resourceIds)];
    const rows = await db
        .select({ resourceId: resources.resourceId })
        .from(resources)
        .where(
            and(
                eq(resources.orgId, orgId),
                eq(resources.mode, "inference"),
                inArray(resources.resourceId, uniqueIds)
            )
        );

    if (rows.length !== uniqueIds.length) {
        return {
            ok: false,
            message:
                "One or more resources are invalid public inference resources for this organization"
        };
    }

    return { ok: true };
}

export async function replaceVirtualApiKeyResources(
    trx: Transaction | typeof db,
    virtualApiKeyId: string,
    resourceIds: number[]
): Promise<void> {
    await trx
        .delete(virtualApiKeyResources)
        .where(eq(virtualApiKeyResources.virtualApiKeyId, virtualApiKeyId));

    const uniqueIds = [...new Set(resourceIds)];
    if (uniqueIds.length === 0) {
        return;
    }

    await trx.insert(virtualApiKeyResources).values(
        uniqueIds.map((resourceId) => ({
            virtualApiKeyId,
            resourceId
        }))
    );
}

async function selectUserVirtualApiKey(
    orgId: string,
    userId: string
): Promise<VirtualApiKey | null> {
    const [existing] = await db
        .select()
        .from(virtualApiKeys)
        .where(
            and(
                eq(virtualApiKeys.orgId, orgId),
                eq(virtualApiKeys.userId, userId),
                eq(virtualApiKeys.kind, "user")
            )
        )
        .limit(1);

    return existing ?? null;
}

export async function getOrCreateUserVirtualApiKey(params: {
    orgId: string;
    user: User;
    createdByUserId?: string | null;
}): Promise<{ key: VirtualApiKey; secret: string }> {
    const { orgId, user, createdByUserId } = params;

    const existing = await selectUserVirtualApiKey(orgId, user.userId);
    if (existing) {
        return {
            key: existing,
            secret: decryptVirtualApiKeyToken(existing.token)
        };
    }

    const minted = mintVirtualApiKeySecret();
    const now = Date.now();

    try {
        const [created] = await db
            .insert(virtualApiKeys)
            .values({
                virtualApiKeyId: minted.virtualApiKeyId,
                orgId,
                kind: "user",
                userId: user.userId,
                name: `${user.name ?? user.username}'s API Key`,
                description: null,
                token: encryptVirtualApiKeyToken(minted.secret),
                lastChars: minted.lastChars,
                allResources: false,
                expiresAt: null,
                lastUsedAt: null,
                createdAt: now,
                createdByUserId: createdByUserId ?? null
            })
            .returning();

        return { key: created, secret: minted.secret };
    } catch {
        const raced = await selectUserVirtualApiKey(orgId, user.userId);
        if (raced) {
            return {
                key: raced,
                secret: decryptVirtualApiKeyToken(raced.token)
            };
        }
        throw new Error("Failed to create user virtual API key");
    }
}

export async function rotateUserVirtualApiKey(params: {
    orgId: string;
    user: User;
    createdByUserId?: string | null;
}): Promise<{ key: VirtualApiKey; secret: string }> {
    const { orgId, user, createdByUserId } = params;
    const existing = await selectUserVirtualApiKey(orgId, user.userId);

    if (!existing) {
        return getOrCreateUserVirtualApiKey(params);
    }

    const minted = mintVirtualApiKeySecret();
    const [updated] = await db
        .update(virtualApiKeys)
        .set({
            token: encryptVirtualApiKeyToken(minted.secret),
            lastChars: minted.lastChars,
            createdByUserId:
                createdByUserId !== undefined
                    ? createdByUserId
                    : existing.createdByUserId
        })
        .where(eq(virtualApiKeys.virtualApiKeyId, existing.virtualApiKeyId))
        .returning();

    return { key: updated, secret: minted.secret };
}
