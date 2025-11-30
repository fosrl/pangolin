import { APP_PATH } from "@server/lib/consts";
import Database from "better-sqlite3";
import path from "path";

const version = "1.12.0";

export default async function migration() {
    console.log(`Running setup script ${version}...`);

    const location = path.join(APP_PATH, "db", "db.sqlite");
    const db = new Database(location);

    try {
        db.pragma("foreign_keys = OFF");

        db.transaction(() => {
            db.prepare(
                `UPDATE 'resourceRules' SET match = 'COUNTRY' WHERE match = 'GEOIP'`
            ).run();

            db.prepare(
                `
        CREATE TABLE 'accessAuditLog' (
            'id' integer PRIMARY KEY AUTOINCREMENT NOT NULL,
            'timestamp' integer NOT NULL,
            'orgId' text NOT NULL,
            'actorType' text,
            'actor' text,
            'actorId' text,
            'resourceId' integer,
            'ip' text,
            'location' text,
            'type' text NOT NULL,
            'action' integer NOT NULL,
            'userAgent' text,
            'metadata' text,
            FOREIGN KEY ('orgId') REFERENCES 'orgs'('orgId') ON UPDATE no action ON DELETE cascade
        );
        `
            ).run();

            db.prepare(
                `CREATE INDEX 'idx_identityAuditLog_timestamp' ON 'accessAuditLog' ('timestamp');`
            ).run();
            db.prepare(
                `CREATE INDEX 'idx_identityAuditLog_org_timestamp' ON 'accessAuditLog' ('orgId','timestamp');`
            ).run();

            db.prepare(
                `
        CREATE TABLE 'actionAuditLog' (
            'id' integer PRIMARY KEY AUTOINCREMENT NOT NULL,
            'timestamp' integer NOT NULL,
            'orgId' text NOT NULL,
            'actorType' text NOT NULL,
            'actor' text NOT NULL,
            'actorId' text NOT NULL,
            'action' text NOT NULL,
            'metadata' text,
            FOREIGN KEY ('orgId') REFERENCES 'orgs'('orgId') ON UPDATE no action ON DELETE cascade
        );
        `
            ).run();

            db.prepare(
                `CREATE INDEX 'idx_actionAuditLog_timestamp' ON 'actionAuditLog' ('timestamp');`
            ).run();
            db.prepare(
                `CREATE INDEX 'idx_actionAuditLog_org_timestamp' ON 'actionAuditLog' ('orgId','timestamp');`
            ).run();

            db.prepare(
                `
        CREATE TABLE 'dnsRecords' (
            'id' integer PRIMARY KEY AUTOINCREMENT NOT NULL,
            'domainId' text NOT NULL,
            'recordType' text NOT NULL,
            'baseDomain' text,
            'value' text NOT NULL,
            'verified' integer DEFAULT false NOT NULL,
            FOREIGN KEY ('domainId') REFERENCES 'domains'('domainId') ON UPDATE no action ON DELETE cascade
        );
        `
            ).run();

            db.prepare(
                `
        CREATE TABLE 'requestAuditLog' (
            'id' integer PRIMARY KEY AUTOINCREMENT NOT NULL,
            'timestamp' integer NOT NULL,
            'orgId' text,
            'action' integer NOT NULL,
            'reason' integer NOT NULL,
            'actorType' text,
            'actor' text,
            'actorId' text,
            'resourceId' integer,
            'ip' text,
            'location' text,
            'userAgent' text,
            'metadata' text,
            'headers' text,
            'query' text,
            'originalRequestURL' text,
            'scheme' text,
            'host' text,
            'path' text,
            'method' text,
            'tls' integer,
            FOREIGN KEY ('orgId') REFERENCES 'orgs'('orgId') ON UPDATE no action ON DELETE cascade
        );
        `
            ).run();


            db.prepare(
                `
        CREATE TABLE 'blueprints' (
                'blueprintId' integer PRIMARY KEY AUTOINCREMENT NOT NULL,
                'orgId' text NOT NULL,
                'name' text NOT NULL,
                'source' text NOT NULL,
                'createdAt' integer NOT NULL,
                'succeeded' integer NOT NULL,
                'contents' text NOT NULL,
                'message' text,
                FOREIGN KEY ('orgId') REFERENCES 'orgs'('orgId') ON UPDATE no action ON DELETE cascade
        );
        `
            ).run();

            db.prepare(
                `CREATE INDEX 'idx_requestAuditLog_timestamp' ON 'requestAuditLog' ('timestamp');`
            ).run();
            db.prepare(
                `CREATE INDEX 'idx_requestAuditLog_org_timestamp' ON 'requestAuditLog' ('orgId','timestamp');`
            ).run();

            db.prepare(
                `
        CREATE TABLE '__new_resources' (
            'resourceId' integer PRIMARY KEY AUTOINCREMENT NOT NULL,
            'resourceGuid' text(36) NOT NULL,
            'orgId' text NOT NULL,
            'niceId' text NOT NULL,
            'name' text NOT NULL,
            'subdomain' text,
            'fullDomain' text,
            'domainId' text,
            'ssl' integer DEFAULT false NOT NULL,
            'blockAccess' integer DEFAULT false NOT NULL,
            'sso' integer DEFAULT true NOT NULL,
            'http' integer DEFAULT true NOT NULL,
            'protocol' text NOT NULL,
            'proxyPort' integer,
            'emailWhitelistEnabled' integer DEFAULT false NOT NULL,
            'applyRules' integer DEFAULT false NOT NULL,
            'enabled' integer DEFAULT true NOT NULL,
            'stickySession' integer DEFAULT false NOT NULL,
            'tlsServerName' text,
            'setHostHeader' text,
            'enableProxy' integer DEFAULT true,
            'skipToIdpId' integer,
            'headers' text,
            'proxyProtocol' integer DEFAULT false NOT NULL,
            'proxyProtocolVersion' integer DEFAULT 1,
            FOREIGN KEY ('orgId') REFERENCES 'orgs'('orgId') ON UPDATE no action ON DELETE cascade,
            FOREIGN KEY ('domainId') REFERENCES 'domains'('domainId') ON UPDATE no action ON DELETE set null,
            FOREIGN KEY ('skipToIdpId') REFERENCES 'idp'('idpId') ON UPDATE no action ON DELETE set null
        );
        `
            ).run();

            db.prepare(
                `INSERT INTO '__new_resources'("resourceId", "resourceGuid", "orgId", "niceId", "name", "subdomain", "fullDomain", "domainId", "ssl", "blockAccess", "sso", "http", "protocol", "proxyPort", "emailWhitelistEnabled", "applyRules", "enabled", "stickySession", "tlsServerName", "setHostHeader", "enableProxy", "skipToIdpId", "headers") SELECT "resourceId", "resourceGuid", "orgId", "niceId", "name", "subdomain", "fullDomain", "domainId", "ssl", "blockAccess", "sso", "http", "protocol", "proxyPort", "emailWhitelistEnabled", "applyRules", "enabled", "stickySession", "tlsServerName", "setHostHeader", "enableProxy", "skipToIdpId", "headers" FROM 'resources';`
            ).run();
            db.prepare(`DROP TABLE 'resources';`).run();
            db.prepare(
                `ALTER TABLE '__new_resources' RENAME TO 'resources';`
            ).run();

            db.prepare(
                `CREATE UNIQUE INDEX 'resources_resourceGuid_unique' ON 'resources' ('resourceGuid');`
            ).run();
            db.prepare(`ALTER TABLE 'domains' ADD 'certResolver' text;`).run();
            db.prepare(
                `ALTER TABLE 'domains' ADD 'preferWildcardCert' integer;`
            ).run();
            db.prepare(
                `ALTER TABLE 'orgs' ADD 'requireTwoFactor' integer;`
            ).run();
            db.prepare(
                `ALTER TABLE 'orgs' ADD 'maxSessionLengthHours' integer;`
            ).run();
            db.prepare(
                `ALTER TABLE 'orgs' ADD 'passwordExpiryDays' integer;`
            ).run();
            db.prepare(
                `ALTER TABLE 'orgs' ADD 'settingsLogRetentionDaysRequest' integer DEFAULT 7 NOT NULL;`
            ).run();
            db.prepare(
                `ALTER TABLE 'orgs' ADD 'settingsLogRetentionDaysAccess' integer DEFAULT 0 NOT NULL;`
            ).run();
            db.prepare(
                `ALTER TABLE 'orgs' ADD 'settingsLogRetentionDaysAction' integer DEFAULT 0 NOT NULL;`
            ).run();
            db.prepare(`ALTER TABLE 'orgs' DROP COLUMN 'settings';`).run();
            db.prepare(
                `ALTER TABLE 'resourceSessions' ADD 'issuedAt' integer;`
            ).run();
            db.prepare(`ALTER TABLE 'session' ADD 'issuedAt' integer;`).run();
            db.prepare(
                `ALTER TABLE 'user' ADD 'lastPasswordChange' integer;`
            ).run();
            db.prepare(`ALTER TABLE 'remoteExitNode' ADD 'secondaryVersion' text;`).run();

            // get all of the domains
            const domains = db.prepare(`SELECT domainId, baseDomain from domains`).all() as {
                domainId: number;
                baseDomain: string;
            }[];

            for (const domain of domains) {
                // insert two records into the dnsRecords table for each domain
                const insert = db.prepare(
                    `INSERT INTO 'dnsRecords' (domainId, recordType, baseDomain, value, verified) VALUES (?, 'A', ?, ?, 1)`
                );
                insert.run(
                    domain.domainId,
                    `*.${domain.baseDomain}`,
                    `Server IP Address`
                );
                insert.run(
                    domain.domainId,
                    `${domain.baseDomain}`,
                    `Server IP Address`
                );
            }
        })();

        db.pragma("foreign_keys = ON");

        console.log(`Migrated database`);
    } catch (e) {
        console.log("Failed to migrate db:", e);
        throw e;
    }

    console.log(`${version} migration complete`);
}
