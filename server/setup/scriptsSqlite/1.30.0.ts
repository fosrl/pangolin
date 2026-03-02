import { APP_PATH } from "@server/lib/consts";
import Database from "better-sqlite3";
import path from "path";

const version = "1.30.0";

export default async function migration() {
    console.log(`Running setup script ${version}...`);

    const location = path.join(APP_PATH, "db", "db.sqlite");
    const db = new Database(location);

    try {
        db.transaction(() => {
            db.prepare(
                `
                CREATE TABLE IF NOT EXISTS 'oauthClients' (
                    'clientId' text PRIMARY KEY NOT NULL,
                    'clientSecretHash' text,
                    'lastChars' text DEFAULT '' NOT NULL,
                    'clientName' text NOT NULL,
                    'clientUri' text,
                    'logoUri' text,
                    'redirectUris' text NOT NULL,
                    'scopes' text DEFAULT 'openid profile email' NOT NULL,
                    'pkceRequired' integer DEFAULT 1 NOT NULL,
                    'enabled' integer DEFAULT 1 NOT NULL,
                    'orgId' text NOT NULL REFERENCES 'orgs'('orgId') ON DELETE cascade,
                    'backchannelLogoutUri' text,
                    'postLogoutRedirectUris' text,
                    'createdAt' integer NOT NULL,
                    'updatedAt' integer NOT NULL
                );
                `
            ).run();
            db.prepare(
                `CREATE INDEX IF NOT EXISTS 'idx_oauthClients_orgId' ON 'oauthClients' ('orgId');`
            ).run();
            db.prepare(
                `CREATE INDEX IF NOT EXISTS 'idx_oauthClients_enabled' ON 'oauthClients' ('enabled');`
            ).run();

            db.prepare(
                `
                CREATE TABLE IF NOT EXISTS 'oauthInteractions' (
                    'interactionId' text PRIMARY KEY NOT NULL,
                    'clientId' text NOT NULL REFERENCES 'oauthClients'('clientId') ON DELETE cascade,
                    'userId' text NOT NULL REFERENCES 'user'('id') ON DELETE cascade,
                    'scope' text NOT NULL,
                    'state' text NOT NULL,
                    'nonce' text,
                    'redirectUri' text NOT NULL,
                    'codeChallenge' text,
                    'codeChallengeMethod' text,
                    'responseType' text NOT NULL,
                    'expiresAt' integer NOT NULL,
                    'createdAt' integer NOT NULL
                );
                `
            ).run();
            db.prepare(
                `CREATE INDEX IF NOT EXISTS 'idx_oauthInteractions_expiresAt' ON 'oauthInteractions' ('expiresAt');`
            ).run();
            db.prepare(
                `CREATE INDEX IF NOT EXISTS 'idx_oauthInteractions_clientId' ON 'oauthInteractions' ('clientId');`
            ).run();
            db.prepare(
                `CREATE INDEX IF NOT EXISTS 'idx_oauthInteractions_userId' ON 'oauthInteractions' ('userId');`
            ).run();

            db.prepare(
                `
                CREATE TABLE IF NOT EXISTS 'oauthAuthorizationCodes' (
                    'codeId' text PRIMARY KEY NOT NULL,
                    'codeHash' text NOT NULL,
                    'clientId' text NOT NULL REFERENCES 'oauthClients'('clientId') ON DELETE cascade,
                    'userId' text NOT NULL REFERENCES 'user'('id') ON DELETE cascade,
                    'scope' text NOT NULL,
                    'redirectUri' text NOT NULL,
                    'codeChallenge' text,
                    'codeChallengeMethod' text,
                    'nonce' text,
                    'expiresAt' integer NOT NULL,
                    'createdAt' integer NOT NULL
                );
                `
            ).run();
            db.prepare(
                `CREATE UNIQUE INDEX IF NOT EXISTS 'uidx_oauthAuthorizationCodes_codeHash' ON 'oauthAuthorizationCodes' ('codeHash');`
            ).run();
            db.prepare(
                `CREATE INDEX IF NOT EXISTS 'idx_oauthAuthorizationCodes_expiresAt' ON 'oauthAuthorizationCodes' ('expiresAt');`
            ).run();
            db.prepare(
                `CREATE INDEX IF NOT EXISTS 'idx_oauthAuthorizationCodes_clientId' ON 'oauthAuthorizationCodes' ('clientId');`
            ).run();
            db.prepare(
                `CREATE INDEX IF NOT EXISTS 'idx_oauthAuthorizationCodes_userId' ON 'oauthAuthorizationCodes' ('userId');`
            ).run();

            db.prepare(
                `
                CREATE TABLE IF NOT EXISTS 'oauthAccessTokens' (
                    'accessTokenId' text PRIMARY KEY NOT NULL,
                    'tokenHash' text NOT NULL,
                    'clientId' text NOT NULL REFERENCES 'oauthClients'('clientId') ON DELETE cascade,
                    'userId' text NOT NULL REFERENCES 'user'('id') ON DELETE cascade,
                    'scope' text NOT NULL,
                    'expiresAt' integer NOT NULL,
                    'createdAt' integer NOT NULL
                );
                `
            ).run();
            db.prepare(
                `CREATE UNIQUE INDEX IF NOT EXISTS 'uidx_oauthAccessTokens_tokenHash' ON 'oauthAccessTokens' ('tokenHash');`
            ).run();
            db.prepare(
                `CREATE INDEX IF NOT EXISTS 'idx_oauthAccessTokens_expiresAt' ON 'oauthAccessTokens' ('expiresAt');`
            ).run();
            db.prepare(
                `CREATE INDEX IF NOT EXISTS 'idx_oauthAccessTokens_clientId' ON 'oauthAccessTokens' ('clientId');`
            ).run();
            db.prepare(
                `CREATE INDEX IF NOT EXISTS 'idx_oauthAccessTokens_userId' ON 'oauthAccessTokens' ('userId');`
            ).run();

            db.prepare(
                `
                CREATE TABLE IF NOT EXISTS 'oauthRefreshTokens' (
                    'refreshTokenId' text PRIMARY KEY NOT NULL,
                    'tokenHash' text NOT NULL,
                    'clientId' text NOT NULL REFERENCES 'oauthClients'('clientId') ON DELETE cascade,
                    'userId' text NOT NULL REFERENCES 'user'('id') ON DELETE cascade,
                    'scope' text NOT NULL,
                    'expiresAt' integer NOT NULL,
                    'revokedAt' integer,
                    'createdAt' integer NOT NULL
                );
                `
            ).run();
            db.prepare(
                `CREATE UNIQUE INDEX IF NOT EXISTS 'uidx_oauthRefreshTokens_tokenHash' ON 'oauthRefreshTokens' ('tokenHash');`
            ).run();
            db.prepare(
                `CREATE INDEX IF NOT EXISTS 'idx_oauthRefreshTokens_expiresAt' ON 'oauthRefreshTokens' ('expiresAt');`
            ).run();
            db.prepare(
                `CREATE INDEX IF NOT EXISTS 'idx_oauthRefreshTokens_clientId' ON 'oauthRefreshTokens' ('clientId');`
            ).run();
            db.prepare(
                `CREATE INDEX IF NOT EXISTS 'idx_oauthRefreshTokens_userId' ON 'oauthRefreshTokens' ('userId');`
            ).run();
            db.prepare(
                `CREATE INDEX IF NOT EXISTS 'idx_oauthRefreshTokens_revokedAt' ON 'oauthRefreshTokens' ('revokedAt');`
            ).run();

            db.prepare(
                `
                CREATE TABLE IF NOT EXISTS 'oauthConsents' (
                    'consentId' text PRIMARY KEY NOT NULL,
                    'userId' text NOT NULL REFERENCES 'user'('id') ON DELETE cascade,
                    'clientId' text NOT NULL REFERENCES 'oauthClients'('clientId') ON DELETE cascade,
                    'scope' text NOT NULL,
                    'createdAt' integer NOT NULL,
                    'updatedAt' integer NOT NULL
                );
                `
            ).run();
            db.prepare(
                `CREATE UNIQUE INDEX IF NOT EXISTS 'uidx_oauthConsents_userId_clientId' ON 'oauthConsents' ('userId', 'clientId');`
            ).run();
            db.prepare(
                `CREATE INDEX IF NOT EXISTS 'idx_oauthConsents_clientId' ON 'oauthConsents' ('clientId');`
            ).run();

            db.prepare(
                `
                CREATE TABLE IF NOT EXISTS 'oauthSigningKeys' (
                    'keyId' text PRIMARY KEY NOT NULL,
                    'algorithm' text NOT NULL,
                    'publicKeyPem' text NOT NULL,
                    'privateKeyPem' text NOT NULL,
                    'active' integer DEFAULT 1 NOT NULL,
                    'createdAt' integer NOT NULL
                );
                `
            ).run();
            db.prepare(
                `CREATE INDEX IF NOT EXISTS 'idx_oauthSigningKeys_active' ON 'oauthSigningKeys' ('active');`
            ).run();
        })();

        console.log("Migrated database");
    } catch (e) {
        console.log("Failed to migrate db:", e);
        throw e;
    }

    console.log(`${version} migration complete`);
}
