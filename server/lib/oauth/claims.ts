import { db, orgs, roles, userOrgs, userOrgRoles, users } from "@server/db";
import { eq, and } from "drizzle-orm";
import { getIssuerUrl } from "@server/lib/oauth/issuer";
import { hasScope } from "@server/lib/oauth/scopes";

type BaseClaims = {
    sub: string;
    email?: string;
    email_verified?: boolean;
    name?: string;
    given_name?: string;
    family_name?: string;
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
        const fullName = user.name || user.username;
        claims.name = fullName;
        claims.preferred_username = user.username;

        const nameParts = fullName.trim().split(/\s+/);
        if (nameParts.length > 1) {
            claims.given_name = nameParts[0];
            claims.family_name = nameParts.slice(1).join(" ");
        } else {
            claims.given_name = fullName;
        }
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
    const baseClaims = await buildBaseClaims(userId, scope);

    return {
        iss: getIssuerUrl(),
        aud: clientId,
        ...(nonce ? { nonce } : {}),
        ...baseClaims
    };
}

export async function buildUserinfoClaims(
    userId: string,
    scope: string
): Promise<Record<string, unknown>> {
    return buildBaseClaims(userId, scope);
}
