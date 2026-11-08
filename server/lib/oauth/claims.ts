import { db, orgs, roles, userOrgs, userOrgRoles, users } from "@server/db";
import { eq, and } from "drizzle-orm";
import { getIssuerUrl } from "@server/lib/oauth/issuer";
import { hasScope } from "@server/lib/oauth/scopes";

type BaseClaims = {
    sub: string;
    email?: string;
    email_verified?: boolean;
    name?: string;
    preferred_username?: string;
    groups?: string[];
};

async function buildBaseClaims(
    userId: string,
    scope: string
): Promise<BaseClaims> {
    const [user] = await db
        .select()
        .from(users)
        .where(eq(users.userId, userId))
        .limit(1);

    if (!user) {
        throw new Error("User not found");
    }

    const claims: BaseClaims = {
        sub: user.userId
    };

    if (hasScope(scope, "email")) {
        if (user.email) {
            claims.email = user.email;
            claims.email_verified = user.emailVerified;
        }
    }

    if (hasScope(scope, "profile")) {
        claims.name = user.name || user.username;
        claims.preferred_username = user.username;
    }

    if (hasScope(scope, "groups")) {
        const memberships = await db
            .select({
                orgName: orgs.name,
                roleName: roles.name
            })
            .from(userOrgs)
            .innerJoin(orgs, eq(userOrgs.orgId, orgs.orgId))
            .innerJoin(
                userOrgRoles,
                and(
                    eq(userOrgRoles.userId, userOrgs.userId),
                    eq(userOrgRoles.orgId, userOrgs.orgId)
                )
            )
            .where(eq(userOrgs.userId, user.userId));

        claims.groups = memberships.map(
            (membership) => `${membership.orgName}:${membership.roleName}`
        );
    }

    return claims;
}

export async function buildIdTokenClaims(
    userId: string,
    clientId: string,
    scope: string,
    nonce?: string
): Promise<Record<string, unknown>> {
    const now = Math.floor(Date.now() / 1000);
    const baseClaims = await buildBaseClaims(userId, scope);

    return {
        iss: getIssuerUrl(),
        sub: baseClaims.sub,
        aud: clientId,
        exp: now + 3600,
        iat: now,
        ...(nonce ? { nonce } : {}),
        ...(baseClaims.email ? { email: baseClaims.email } : {}),
        ...(baseClaims.email_verified !== undefined
            ? { email_verified: baseClaims.email_verified }
            : {}),
        ...(baseClaims.name ? { name: baseClaims.name } : {}),
        ...(baseClaims.preferred_username
            ? { preferred_username: baseClaims.preferred_username }
            : {}),
        ...(baseClaims.groups ? { groups: baseClaims.groups } : {})
    };
}

export async function buildUserinfoClaims(
    userId: string,
    scope: string
): Promise<Record<string, unknown>> {
    const baseClaims = await buildBaseClaims(userId, scope);

    return {
        sub: baseClaims.sub,
        ...(baseClaims.email ? { email: baseClaims.email } : {}),
        ...(baseClaims.email_verified !== undefined
            ? { email_verified: baseClaims.email_verified }
            : {}),
        ...(baseClaims.name ? { name: baseClaims.name } : {}),
        ...(baseClaims.preferred_username
            ? { preferred_username: baseClaims.preferred_username }
            : {}),
        ...(baseClaims.groups ? { groups: baseClaims.groups } : {})
    };
}
