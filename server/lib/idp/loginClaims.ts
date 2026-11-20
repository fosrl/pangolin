import { db, userIdpClaims, type Idp } from "@server/db";
import config from "@server/lib/config";
import { decrypt, encrypt } from "@server/lib/crypto";
import logger from "@server/logger";
import { eq } from "drizzle-orm";

/**
 * Snapshots of the claims of each user's last OIDC login, kept only when the
 * IdP has `storeLoginClaims` on. Encrypted with the server secret: claims carry
 * personal data.
 */

// a snapshot bigger than this is skipped rather than bloating the database
const MAX_SNAPSHOT_BYTES = 256 * 1024;

export type LoginClaimsSnapshot = {
    idpId: number;
    claims: Record<string, unknown>;
    /** Claim keys added or changed by the IdP API integration. */
    enrichedClaimKeys: string[];
    /** Epoch ms. */
    capturedAt: number;
};

/** Claim keys whose value differs between `before` and `after`. */
export function changedClaimKeys(
    before: Record<string, unknown>,
    after: Record<string, unknown>
): string[] {
    return Object.keys(after).filter(
        (key) => JSON.stringify(before[key]) !== JSON.stringify(after[key])
    );
}

/** Stores the login's claims for the user. Never throws: login must not fail on it. */
export async function saveLoginClaims({
    idp,
    userId,
    claims,
    enrichedClaimKeys
}: {
    idp: Idp;
    userId: string;
    claims: Record<string, unknown>;
    enrichedClaimKeys: string[];
}): Promise<void> {
    if (!idp.storeLoginClaims) {
        return;
    }

    try {
        const json = JSON.stringify({ claims, enrichedClaimKeys });
        if (json.length > MAX_SNAPSHOT_BYTES) {
            logger.warn(
                `IdP ${idp.idpId}: login claims of user ${userId} are too large to store (${json.length} bytes)`
            );
            return;
        }

        const values = {
            idpId: idp.idpId,
            claims: encrypt(json, config.getRawConfig().server.secret!),
            capturedAt: Date.now()
        };
        await db
            .insert(userIdpClaims)
            .values({ userId, ...values })
            .onConflictDoUpdate({ target: userIdpClaims.userId, set: values });
    } catch (e) {
        logger.error(`IdP ${idp.idpId}: failed to store login claims`, {
            error: e instanceof Error ? e.message : e
        });
    }
}

export async function getLoginClaims(
    userId: string
): Promise<LoginClaimsSnapshot | null> {
    const [row] = await db
        .select()
        .from(userIdpClaims)
        .where(eq(userIdpClaims.userId, userId))
        .limit(1);
    if (!row) {
        return null;
    }

    const parsed = JSON.parse(
        decrypt(row.claims, config.getRawConfig().server.secret!)
    ) as { claims: Record<string, unknown>; enrichedClaimKeys?: string[] };

    return {
        idpId: row.idpId,
        claims: parsed.claims,
        enrichedClaimKeys: parsed.enrichedClaimKeys ?? [],
        capturedAt: row.capturedAt
    };
}

/** Deletes every stored snapshot of the IdP, when `storeLoginClaims` is turned off. */
export async function deleteLoginClaimsForIdp(idpId: number): Promise<void> {
    await db.delete(userIdpClaims).where(eq(userIdpClaims.idpId, idpId));
}
