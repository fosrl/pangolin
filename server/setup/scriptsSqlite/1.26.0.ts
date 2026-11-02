import { APP_PATH } from "@server/lib/consts";
import Database from "better-sqlite3";
import path from "path";

const version = "1.26.0";

export default async function migration() {
    console.log(`Running setup script ${version}...`);

    const location = path.join(APP_PATH, "db", "db.sqlite");
    const db = new Database(location);

    try {
        db.transaction(() => {
            db.prepare(
                `ALTER TABLE 'orgs' ADD 'settingsLogRetentionDaysSsh' integer DEFAULT 0 NOT NULL;`
            ).run();
            db.prepare(
                `
                CREATE TABLE 'sshSessionLog' (
                    'id' integer PRIMARY KEY AUTOINCREMENT NOT NULL,
                    'sessionId' text NOT NULL,
                    'orgId' text NOT NULL,
                    'siteId' integer NOT NULL,
                    'siteResourceId' integer,
                    'resourceId' integer,
                    'clientId' integer,
                    'userId' text,
                    'transport' text DEFAULT 'ssh' NOT NULL,
                    'sourceAddr' text NOT NULL,
                    'destAddr' text NOT NULL,
                    'username' text NOT NULL,
                    'authMethod' text,
                    'keyFingerprint' text,
                    'certKeyId' text,
                    'commandCount' integer DEFAULT 0 NOT NULL,
                    'startedAt' integer NOT NULL,
                    'endedAt' integer,
                    FOREIGN KEY ('orgId') REFERENCES 'orgs'('orgId') ON UPDATE no action ON DELETE cascade,
                    FOREIGN KEY ('siteId') REFERENCES 'sites'('siteId') ON UPDATE no action ON DELETE cascade,
                    FOREIGN KEY ('siteResourceId') REFERENCES 'siteResources'('siteResourceId') ON UPDATE no action ON DELETE set null,
                    FOREIGN KEY ('resourceId') REFERENCES 'resources'('resourceId') ON UPDATE no action ON DELETE set null,
                    FOREIGN KEY ('clientId') REFERENCES 'clients'('clientId') ON UPDATE no action ON DELETE set null,
                    FOREIGN KEY ('userId') REFERENCES 'user'('id') ON UPDATE no action ON DELETE set null
                );
                `
            ).run();
            db.prepare(
                `
                CREATE TABLE 'sshCommandLog' (
                    'id' integer PRIMARY KEY AUTOINCREMENT NOT NULL,
                    'sshSessionLogId' integer NOT NULL,
                    'orgId' text NOT NULL,
                    'command' text NOT NULL,
                    'channel' text NOT NULL,
                    'inexact' integer DEFAULT false NOT NULL,
                    'timestamp' integer NOT NULL,
                    FOREIGN KEY ('sshSessionLogId') REFERENCES 'sshSessionLog'('id') ON UPDATE no action ON DELETE cascade,
                    FOREIGN KEY ('orgId') REFERENCES 'orgs'('orgId') ON UPDATE no action ON DELETE cascade
                );
                `
            ).run();
            db.prepare(
                `CREATE UNIQUE INDEX 'idx_ssh_session_log_site_session' ON 'sshSessionLog' ('siteId','sessionId');`
            ).run();
            db.prepare(
                `CREATE INDEX 'idx_ssh_session_log_org_started' ON 'sshSessionLog' ('orgId','startedAt');`
            ).run();
            db.prepare(
                `CREATE INDEX 'idx_ssh_session_log_org_site_resource_started' ON 'sshSessionLog' ('orgId','siteResourceId','startedAt');`
            ).run();
            db.prepare(
                `CREATE INDEX 'idx_ssh_session_log_org_resource_started' ON 'sshSessionLog' ('orgId','resourceId','startedAt');`
            ).run();
            db.prepare(
                `CREATE INDEX 'idx_ssh_session_log_org_user_started' ON 'sshSessionLog' ('orgId','userId','startedAt');`
            ).run();
            db.prepare(
                `CREATE INDEX 'idx_ssh_command_log_session_timestamp' ON 'sshCommandLog' ('sshSessionLogId','timestamp');`
            ).run();
            db.prepare(
                `CREATE INDEX 'idx_ssh_command_log_org_timestamp' ON 'sshCommandLog' ('orgId','timestamp');`
            ).run();
        })();

        console.log("Migrated database");
    } catch (e) {
        console.log("Failed to migrate db:", e);
        throw e;
    }

    console.log(`${version} migration complete`);
}
