import {
    generateId,
    generateIdFromEntropySize
} from "@server/auth/sessions/app";
import { db, idpTestLinks, users, type IdpTestLink } from "@server/db";
import config from "@server/lib/config";
import { decrypt, encrypt } from "@server/lib/crypto";
import { encodeHexLowerCase } from "@oslojs/encoding";
import { sha256 } from "@oslojs/crypto/sha2";
import { and, desc, eq, isNotNull, isNull, lt } from "drizzle-orm";
import logger from "@server/logger";
import type { OidcTestResult } from "./previewIdpLogin";

/**
 * Single-use links an admin sends to someone so they run a test login: the
 * result (their claims and what the policies would do) goes to the admins of
 * the IdP, not to them. The token is only shown once; we keep its hash.
 */

/** How long a link can be used after it's created. */
export const TEST_LINK_TTL_MS = 24 * 60 * 60 * 1000;
/**
 * Links, and their results, are deleted this long after they're created: a
 * result stays 6 to 7 days, an unused link shows as expired for 6 days.
 */
export const TEST_LINK_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const TEST_LINK_CLEANUP_INTERVAL_MS = 60 * 60 * 1000;

export type TestLinkStatus = "pending" | "completed" | "expired";

export type TestLinkSummary = {
    linkId: string;
    label: string | null;
    createdBy: string | null;
    createdAt: number;
    expiresAt: number;
    completedAt: number | null;
    status: TestLinkStatus;
};

function hashToken(token: string): string {
    return encodeHexLowerCase(sha256(new TextEncoder().encode(token)));
}

export function testLinkStatus(
    link: Pick<IdpTestLink, "completedAt" | "expiresAt">,
    now = Date.now()
): TestLinkStatus {
    if (link.completedAt) return "completed";
    if (link.expiresAt <= now) return "expired";
    return "pending";
}

/** Same scope as the route: an org link belongs to its org, a global one to no org. */
function scopeFilter(idpId: number, orgId: string | null) {
    return and(
        eq(idpTestLinks.idpId, idpId),
        orgId ? eq(idpTestLinks.orgId, orgId) : isNull(idpTestLinks.orgId)
    );
}

export async function createTestLink({
    idpId,
    orgId,
    createdBy,
    label
}: {
    idpId: number;
    orgId: string | null;
    createdBy: string;
    label: string | null;
}): Promise<{ linkId: string; token: string; expiresAt: number }> {
    const token = generateIdFromEntropySize(25);
    const linkId = generateId(15);
    const now = Date.now();
    const expiresAt = now + TEST_LINK_TTL_MS;

    await db.insert(idpTestLinks).values({
        linkId,
        tokenHash: hashToken(token),
        idpId,
        orgId,
        createdBy,
        label,
        createdAt: now,
        expiresAt
    });

    return { linkId, token, expiresAt };
}

export async function findTestLinkByToken(
    idpId: number,
    token: string
): Promise<IdpTestLink | null> {
    const [link] = await db
        .select()
        .from(idpTestLinks)
        .where(
            and(
                eq(idpTestLinks.tokenHash, hashToken(token)),
                eq(idpTestLinks.idpId, idpId)
            )
        )
        .limit(1);
    return link ?? null;
}

export async function getTestLink(linkId: string): Promise<IdpTestLink | null> {
    const [link] = await db
        .select()
        .from(idpTestLinks)
        .where(eq(idpTestLinks.linkId, linkId))
        .limit(1);
    return link ?? null;
}

/**
 * Stores the result and marks the link used. Returns false when it was already
 * used (two logins racing on the same link).
 */
export async function completeTestLink(
    linkId: string,
    result: OidcTestResult
): Promise<boolean> {
    const updated = await db
        .update(idpTestLinks)
        .set({
            completedAt: Date.now(),
            result: encrypt(
                JSON.stringify(result),
                config.getRawConfig().server.secret!
            )
        })
        .where(
            and(
                eq(idpTestLinks.linkId, linkId),
                isNull(idpTestLinks.completedAt)
            )
        )
        .returning({ linkId: idpTestLinks.linkId });
    return updated.length > 0;
}

export async function listTestLinks(
    idpId: number,
    orgId: string | null
): Promise<(TestLinkSummary & { createdByName: string | null })[]> {
    const rows = await db
        .select({
            link: idpTestLinks,
            creatorName: users.name,
            creatorEmail: users.email,
            creatorUsername: users.username
        })
        .from(idpTestLinks)
        .leftJoin(users, eq(users.userId, idpTestLinks.createdBy))
        .where(scopeFilter(idpId, orgId))
        .orderBy(desc(idpTestLinks.createdAt));

    const now = Date.now();
    return rows.map(({ link, creatorName, creatorEmail, creatorUsername }) => ({
        linkId: link.linkId,
        label: link.label,
        createdBy: link.createdBy,
        createdByName: creatorName ?? creatorEmail ?? creatorUsername ?? null,
        createdAt: link.createdAt,
        expiresAt: link.expiresAt,
        completedAt: link.completedAt,
        status: testLinkStatus(link, now)
    }));
}

/** The most recently completed link of this IdP and scope, with its result. */
export async function getLatestCompletedTestLink(
    idpId: number,
    orgId: string | null
): Promise<{ link: IdpTestLink; result: OidcTestResult } | null> {
    const [link] = await db
        .select()
        .from(idpTestLinks)
        .where(
            and(
                scopeFilter(idpId, orgId),
                isNotNull(idpTestLinks.completedAt),
                isNotNull(idpTestLinks.result)
            )
        )
        .orderBy(desc(idpTestLinks.completedAt))
        .limit(1);
    if (!link?.result) {
        return null;
    }
    return {
        link,
        result: JSON.parse(
            decrypt(link.result, config.getRawConfig().server.secret!)
        ) as OidcTestResult
    };
}

/** The link if it belongs to this IdP and scope, with its decrypted result. */
export async function getScopedTestLink(
    linkId: string,
    idpId: number,
    orgId: string | null
): Promise<{ link: IdpTestLink; result: OidcTestResult | null } | null> {
    const [link] = await db
        .select()
        .from(idpTestLinks)
        .where(and(eq(idpTestLinks.linkId, linkId), scopeFilter(idpId, orgId)))
        .limit(1);
    if (!link) {
        return null;
    }
    return {
        link,
        result: link.result
            ? (JSON.parse(
                  decrypt(link.result, config.getRawConfig().server.secret!)
              ) as OidcTestResult)
            : null
    };
}

export async function deleteTestLink(
    linkId: string,
    idpId: number,
    orgId: string | null
): Promise<boolean> {
    const deleted = await db
        .delete(idpTestLinks)
        .where(and(eq(idpTestLinks.linkId, linkId), scopeFilter(idpId, orgId)))
        .returning({ linkId: idpTestLinks.linkId });
    return deleted.length > 0;
}

/** Deletes the links (and results) older than `TEST_LINK_RETENTION_MS`. */
export async function cleanUpOldTestLinks(): Promise<number> {
    const deleted = await db
        .delete(idpTestLinks)
        .where(lt(idpTestLinks.createdAt, Date.now() - TEST_LINK_RETENTION_MS))
        .returning({ linkId: idpTestLinks.linkId });
    return deleted.length;
}

/**
 * Hourly cleanup of old test links, on every build (results hold personal
 * data). Safe on several nodes at once: deleting is idempotent.
 */
export function initTestLinkCleanupInterval() {
    const run = async () => {
        try {
            const count = await cleanUpOldTestLinks();
            if (count > 0) {
                logger.debug(`Deleted ${count} old IdP test link(s)`);
            }
        } catch (e) {
            logger.error("Failed to clean up old IdP test links", {
                error: e instanceof Error ? e.message : e
            });
        }
    };
    run();
    return setInterval(run, TEST_LINK_CLEANUP_INTERVAL_MS);
}
