import { APP_PATH } from "@server/lib/consts";
import Database from "better-sqlite3";
import path from "path";

const version = "1.19.5";

export default async function migration() {
    console.log(`Running setup script ${version}...`);

    const location = path.join(APP_PATH, "db", "db.sqlite");
    const db = new Database(location);

    try {
        db.pragma("foreign_keys = OFF");

        db.transaction(() => {
            // The 1.19.0 migration added policyPasswordId/policyPincodeId/policyWhitelistId to
            // resourceSessions via inline REFERENCES clauses with no ON DELETE action, unlike the
            // Postgres migration which correctly used "ON DELETE cascade". SQLite can't alter an
            // existing foreign key, so rebuild the table to match resourceSessions in schema.ts.
            db.prepare(
                `
            CREATE TABLE 'resourceSessions_new' (
                'id' text PRIMARY KEY NOT NULL,
                'resourceId' integer NOT NULL,
                'expiresAt' integer NOT NULL,
                'sessionLength' integer NOT NULL,
                'doNotExtend' integer DEFAULT false NOT NULL,
                'isRequestToken' integer,
                'userSessionId' text,
                'passwordId' integer,
                'pincodeId' integer,
                'whitelistId' integer,
                'accessTokenId' text,
                'policyPasswordId' integer,
                'policyPincodeId' integer,
                'policyWhitelistId' integer,
                'issuedAt' integer,
                FOREIGN KEY ('resourceId') REFERENCES 'resources'('resourceId') ON UPDATE no action ON DELETE cascade,
                FOREIGN KEY ('userSessionId') REFERENCES 'session'('id') ON UPDATE no action ON DELETE cascade,
                FOREIGN KEY ('passwordId') REFERENCES 'resourcePassword'('passwordId') ON UPDATE no action ON DELETE cascade,
                FOREIGN KEY ('pincodeId') REFERENCES 'resourcePincode'('pincodeId') ON UPDATE no action ON DELETE cascade,
                FOREIGN KEY ('whitelistId') REFERENCES 'resourceWhitelist'('id') ON UPDATE no action ON DELETE cascade,
                FOREIGN KEY ('accessTokenId') REFERENCES 'resourceAccessToken'('accessTokenId') ON UPDATE no action ON DELETE cascade,
                FOREIGN KEY ('policyPasswordId') REFERENCES 'resourcePolicyPassword'('passwordId') ON UPDATE no action ON DELETE cascade,
                FOREIGN KEY ('policyPincodeId') REFERENCES 'resourcePolicyPincode'('pincodeId') ON UPDATE no action ON DELETE cascade,
                FOREIGN KEY ('policyWhitelistId') REFERENCES 'resourcePolicyWhitelist'('id') ON UPDATE no action ON DELETE cascade
            );
                `
            ).run();

            db.prepare(
                `
            INSERT INTO 'resourceSessions_new' (
                "id",
                "resourceId",
                "expiresAt",
                "sessionLength",
                "doNotExtend",
                "isRequestToken",
                "userSessionId",
                "passwordId",
                "pincodeId",
                "whitelistId",
                "accessTokenId",
                "policyPasswordId",
                "policyPincodeId",
                "policyWhitelistId",
                "issuedAt"
            )
            SELECT
                "id",
                "resourceId",
                "expiresAt",
                "sessionLength",
                "doNotExtend",
                "isRequestToken",
                "userSessionId",
                "passwordId",
                "pincodeId",
                "whitelistId",
                "accessTokenId",
                "policyPasswordId",
                "policyPincodeId",
                "policyWhitelistId",
                "issuedAt"
            FROM 'resourceSessions';
                `
            ).run();

            db.prepare(`DROP TABLE 'resourceSessions';`).run();
            db.prepare(
                `ALTER TABLE 'resourceSessions_new' RENAME TO 'resourceSessions';`
            ).run();
        })();

        db.pragma("foreign_keys = ON");

        console.log("Migrated database");
    } catch (e) {
        console.log("Failed to migrate db:", e);
        throw e;
    }

    console.log(`${version} migration complete`);
}
