import { db } from "@server/db/pg/driver";
import { sql } from "drizzle-orm";

const version = "1.30.0";

export default async function migration() {
    console.log(`Running setup script ${version}...`);

    try {
        await db.execute(sql`BEGIN`);

        await db.execute(sql`
            CREATE TABLE IF NOT EXISTS "oauthClients" (
                "clientId" text PRIMARY KEY NOT NULL,
                "clientSecretHash" text,
                "lastChars" text DEFAULT '' NOT NULL,
                "clientName" text NOT NULL,
                "clientUri" text,
                "logoUri" text,
                "redirectUris" json NOT NULL,
                "scopes" text DEFAULT 'openid profile email' NOT NULL,
                "pkceRequired" boolean DEFAULT true NOT NULL,
                "enabled" boolean DEFAULT true NOT NULL,
                "orgId" text NOT NULL REFERENCES "orgs"("orgId") ON DELETE cascade,
                "backchannelLogoutUri" varchar,
                "postLogoutRedirectUris" json,
                "createdAt" bigint NOT NULL,
                "updatedAt" bigint NOT NULL
            );
        `);
        await db.execute(
            sql`CREATE INDEX IF NOT EXISTS "idx_oauthClients_orgId" ON "oauthClients" ("orgId");`
        );
        await db.execute(
            sql`CREATE INDEX IF NOT EXISTS "idx_oauthClients_enabled" ON "oauthClients" ("enabled");`
        );

        await db.execute(sql`
            CREATE TABLE IF NOT EXISTS "oauthInteractions" (
                "interactionId" text PRIMARY KEY NOT NULL,
                "clientId" text NOT NULL REFERENCES "oauthClients"("clientId") ON DELETE cascade,
                "userId" text NOT NULL REFERENCES "user"("id") ON DELETE cascade,
                "scope" text NOT NULL,
                "state" text NOT NULL,
                "nonce" text,
                "redirectUri" text NOT NULL,
                "codeChallenge" text,
                "codeChallengeMethod" text,
                "responseType" text NOT NULL,
                "expiresAt" bigint NOT NULL,
                "createdAt" bigint NOT NULL
            );
        `);
        await db.execute(
            sql`CREATE INDEX IF NOT EXISTS "idx_oauthInteractions_expiresAt" ON "oauthInteractions" ("expiresAt");`
        );
        await db.execute(
            sql`CREATE INDEX IF NOT EXISTS "idx_oauthInteractions_clientId" ON "oauthInteractions" ("clientId");`
        );
        await db.execute(
            sql`CREATE INDEX IF NOT EXISTS "idx_oauthInteractions_userId" ON "oauthInteractions" ("userId");`
        );

        await db.execute(sql`
            CREATE TABLE IF NOT EXISTS "oauthAuthorizationCodes" (
                "codeId" text PRIMARY KEY NOT NULL,
                "codeHash" text NOT NULL,
                "clientId" text NOT NULL REFERENCES "oauthClients"("clientId") ON DELETE cascade,
                "userId" text NOT NULL REFERENCES "user"("id") ON DELETE cascade,
                "scope" text NOT NULL,
                "redirectUri" text NOT NULL,
                "codeChallenge" text,
                "codeChallengeMethod" text,
                "nonce" text,
                "expiresAt" bigint NOT NULL,
                "createdAt" bigint NOT NULL
            );
        `);
        await db.execute(
            sql`CREATE UNIQUE INDEX IF NOT EXISTS "uidx_oauthAuthorizationCodes_codeHash" ON "oauthAuthorizationCodes" ("codeHash");`
        );
        await db.execute(
            sql`CREATE INDEX IF NOT EXISTS "idx_oauthAuthorizationCodes_expiresAt" ON "oauthAuthorizationCodes" ("expiresAt");`
        );
        await db.execute(
            sql`CREATE INDEX IF NOT EXISTS "idx_oauthAuthorizationCodes_clientId" ON "oauthAuthorizationCodes" ("clientId");`
        );
        await db.execute(
            sql`CREATE INDEX IF NOT EXISTS "idx_oauthAuthorizationCodes_userId" ON "oauthAuthorizationCodes" ("userId");`
        );

        await db.execute(sql`
            CREATE TABLE IF NOT EXISTS "oauthAccessTokens" (
                "accessTokenId" text PRIMARY KEY NOT NULL,
                "tokenHash" text NOT NULL,
                "clientId" text NOT NULL REFERENCES "oauthClients"("clientId") ON DELETE cascade,
                "userId" text NOT NULL REFERENCES "user"("id") ON DELETE cascade,
                "scope" text NOT NULL,
                "expiresAt" bigint NOT NULL,
                "createdAt" bigint NOT NULL
            );
        `);
        await db.execute(
            sql`CREATE UNIQUE INDEX IF NOT EXISTS "uidx_oauthAccessTokens_tokenHash" ON "oauthAccessTokens" ("tokenHash");`
        );
        await db.execute(
            sql`CREATE INDEX IF NOT EXISTS "idx_oauthAccessTokens_expiresAt" ON "oauthAccessTokens" ("expiresAt");`
        );
        await db.execute(
            sql`CREATE INDEX IF NOT EXISTS "idx_oauthAccessTokens_clientId" ON "oauthAccessTokens" ("clientId");`
        );
        await db.execute(
            sql`CREATE INDEX IF NOT EXISTS "idx_oauthAccessTokens_userId" ON "oauthAccessTokens" ("userId");`
        );

        await db.execute(sql`
            CREATE TABLE IF NOT EXISTS "oauthRefreshTokens" (
                "refreshTokenId" text PRIMARY KEY NOT NULL,
                "tokenHash" text NOT NULL,
                "clientId" text NOT NULL REFERENCES "oauthClients"("clientId") ON DELETE cascade,
                "userId" text NOT NULL REFERENCES "user"("id") ON DELETE cascade,
                "scope" text NOT NULL,
                "expiresAt" bigint NOT NULL,
                "revokedAt" bigint,
                "createdAt" bigint NOT NULL
            );
        `);
        await db.execute(
            sql`CREATE UNIQUE INDEX IF NOT EXISTS "uidx_oauthRefreshTokens_tokenHash" ON "oauthRefreshTokens" ("tokenHash");`
        );
        await db.execute(
            sql`CREATE INDEX IF NOT EXISTS "idx_oauthRefreshTokens_expiresAt" ON "oauthRefreshTokens" ("expiresAt");`
        );
        await db.execute(
            sql`CREATE INDEX IF NOT EXISTS "idx_oauthRefreshTokens_clientId" ON "oauthRefreshTokens" ("clientId");`
        );
        await db.execute(
            sql`CREATE INDEX IF NOT EXISTS "idx_oauthRefreshTokens_userId" ON "oauthRefreshTokens" ("userId");`
        );
        await db.execute(
            sql`CREATE INDEX IF NOT EXISTS "idx_oauthRefreshTokens_revokedAt" ON "oauthRefreshTokens" ("revokedAt");`
        );

        await db.execute(sql`
            CREATE TABLE IF NOT EXISTS "oauthConsents" (
                "consentId" text PRIMARY KEY NOT NULL,
                "userId" text NOT NULL REFERENCES "user"("id") ON DELETE cascade,
                "clientId" text NOT NULL REFERENCES "oauthClients"("clientId") ON DELETE cascade,
                "scope" text NOT NULL,
                "createdAt" bigint NOT NULL,
                "updatedAt" bigint NOT NULL
            );
        `);
        await db.execute(
            sql`CREATE UNIQUE INDEX IF NOT EXISTS "uidx_oauthConsents_userId_clientId" ON "oauthConsents" ("userId", "clientId");`
        );
        await db.execute(
            sql`CREATE INDEX IF NOT EXISTS "idx_oauthConsents_clientId" ON "oauthConsents" ("clientId");`
        );

        await db.execute(sql`
            CREATE TABLE IF NOT EXISTS "oauthSigningKeys" (
                "keyId" text PRIMARY KEY NOT NULL,
                "algorithm" text NOT NULL,
                "publicKeyPem" text NOT NULL,
                "privateKeyPem" text NOT NULL,
                "active" boolean DEFAULT true NOT NULL,
                "createdAt" bigint NOT NULL
            );
        `);
        await db.execute(
            sql`CREATE INDEX IF NOT EXISTS "idx_oauthSigningKeys_active" ON "oauthSigningKeys" ("active");`
        );

        await db.execute(sql`COMMIT`);
        console.log("Migrated database");
    } catch (e) {
        await db.execute(sql`ROLLBACK`);
        console.log("Unable to migrate database");
        console.log(e);
        throw e;
    }

    console.log(`${version} migration complete`);
}
