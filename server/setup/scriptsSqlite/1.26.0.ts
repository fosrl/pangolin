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
                `
                ALTER TABLE 'resources' ADD 'matchBaseDomain' integer DEFAULT false NOT NULL;
                `
            ).run();
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

            db.prepare(
                `CREATE TABLE 'customDnsRecords' (
                    'customDnsRecordId' integer PRIMARY KEY AUTOINCREMENT NOT NULL,
                    'domainId' text NOT NULL,
                    'name' text NOT NULL,
                    'fullDomain' text NOT NULL,
                    'type' text NOT NULL,
                    'values' text NOT NULL,
                    'ttl' integer DEFAULT 300 NOT NULL,
                    'priority' integer,
                    'weight' integer,
                    'port' integer,
                    'enabled' integer DEFAULT true NOT NULL,
                    'createdAt' integer NOT NULL,
                    'updatedAt' integer NOT NULL,
                    FOREIGN KEY ('domainId') REFERENCES 'domains'('domainId') ON UPDATE no action ON DELETE cascade
                );`
            ).run();

            db.prepare(
                `CREATE INDEX 'idx_customDnsRecords_fullDomain' ON 'customDnsRecords' ('fullDomain');`
            ).run();

            db.prepare(
                `CREATE INDEX 'idx_customDnsRecords_domainId' ON 'customDnsRecords' ('domainId');`
            ).run();

            db.prepare(
                `CREATE TABLE 'resourceSessionReauth' (
                    'userSessionId' text NOT NULL,
                    'resourceId' integer NOT NULL,
                    'revokedAt' integer NOT NULL,
                    PRIMARY KEY('userSessionId', 'resourceId'),
                    FOREIGN KEY ('userSessionId') REFERENCES 'session'('id') ON UPDATE no action ON DELETE cascade,
                    FOREIGN KEY ('resourceId') REFERENCES 'resources'('resourceId') ON UPDATE no action ON DELETE cascade
                );`
            ).run();

            db.prepare(
                `CREATE TABLE 'idpGrants' (
                    'grantId' text PRIMARY KEY NOT NULL,
                    'idpId' integer NOT NULL,
                    'refreshToken' text NOT NULL,
                    'validatedAt' integer NOT NULL,
                    'attemptedAt' integer,
                    'leaseId' text,
                    'leaseExpiresAt' integer,
                    'revokedAt' integer,
                    FOREIGN KEY ('idpId') REFERENCES 'idp'('idpId') ON UPDATE no action ON DELETE cascade
                );`
            ).run();

            db.prepare(
                `CREATE TABLE 'sessionIdpGrants' (
                    'sessionId' text PRIMARY KEY NOT NULL,
                    'grantId' text NOT NULL,
                    FOREIGN KEY ('sessionId') REFERENCES 'session'('id') ON UPDATE no action ON DELETE cascade,
                    FOREIGN KEY ('grantId') REFERENCES 'idpGrants'('grantId') ON UPDATE no action ON DELETE cascade
                );`
            ).run();

            db.prepare(
                `ALTER TABLE 'deviceWebAuthCodes' ADD 'approvingSessionId' text;`
            ).run();
            db.prepare(
                `ALTER TABLE 'idp' ADD 'sessionRevalidation' integer DEFAULT false NOT NULL;`
            ).run();

            db.prepare(
                `ALTER TABLE 'resourceSessions' ADD 'requestSessionId' text;`
            ).run();
        })();

        console.log("Migrated database");
    } catch (e) {
        console.log("Failed to migrate db:", e);
        throw e;
    }

    console.log(`${version} migration complete`);
}
