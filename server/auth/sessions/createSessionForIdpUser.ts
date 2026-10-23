import { db, userOrgs, users } from "@server/db";
import { and, eq } from "drizzle-orm";
import createHttpError from "http-errors";
import HttpCode from "@server/types/HttpCode";
import { createSession, generateSessionToken } from "./app";

/**
 * Mints a Pangolin user session token for an already-provisioned user.
 *
 * This is the non-interactive counterpart to the OIDC browser flow: a trusted
 * caller (holding the root API key) bridges an external IdP session into
 * Pangolin without the redirect dance. It does NOT do OIDC claim-mapping or
 * autoprovision — those need the live OIDC code/tokens, which we don't have
 * here. It only verifies membership and mints a session, mirroring the
 * non-autoprovision rejection logic in validateOidcCallback.ts.
 */
export async function createSessionForIdpUser(
    userId: string,
    opts?: { orgId?: string; idpId?: number }
): Promise<{ token: string; expiresAt: number }> {
    const [existingUser] = await db
        .select()
        .from(users)
        .where(eq(users.userId, userId));

    if (!existingUser) {
        throw createHttpError(HttpCode.NOT_FOUND, "User not found");
    }

    if (opts?.idpId !== undefined && existingUser.idpId !== opts.idpId) {
        throw createHttpError(
            HttpCode.UNAUTHORIZED,
            "User does not belong to the specified IdP"
        );
    }

    if (opts?.orgId !== undefined) {
        const [membership] = await db
            .select()
            .from(userOrgs)
            .where(
                and(
                    eq(userOrgs.userId, existingUser.userId),
                    eq(userOrgs.orgId, opts.orgId)
                )
            );

        if (!membership) {
            throw createHttpError(
                HttpCode.UNAUTHORIZED,
                `User ${existingUser.username} is not a member of the specified organization. This user must be added to the organization before a session can be created.`
            );
        }
    }

    const token = generateSessionToken();
    const sess = await createSession(token, existingUser.userId);
    return { token, expiresAt: sess.expiresAt };
}
