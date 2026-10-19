import { APP_PATH } from "@server/lib/consts";
import Database from "better-sqlite3";
import path from "path";

const version = "1.25.0";

export default async function migration() {
    console.log(`Running setup script ${version}...`);

    const location = path.join(APP_PATH, "db", "db.sqlite");
    const db = new Database(location);

    try {
        db.pragma("foreign_keys = OFF");

        db.transaction(() => {
            db.prepare(
                `
                CREATE TABLE 'resourceMtlsCertificates' (
                    'mtlsCertificateId' integer PRIMARY KEY AUTOINCREMENT NOT NULL,
                    'resourceId' integer NOT NULL,
                    'name' text,
                    'certificate' text NOT NULL,
                    'subject' text,
                    'issuer' text,
                    'serialNumber' text,
                    'fingerprint' text,
                    'notBefore' integer,
                    'notAfter' integer,
                    'createdAt' integer NOT NULL,
                    FOREIGN KEY ('resourceId') REFERENCES 'resources'('resourceId') ON UPDATE no action ON DELETE cascade
                );
                `
            ).run();
            db.prepare(
                `
                CREATE TABLE 'clientOrgRoles' (
                    'clientId' integer NOT NULL,
                    'orgId' text NOT NULL,
                    'roleId' integer NOT NULL,
                    FOREIGN KEY ('clientId') REFERENCES 'clients'('clientId') ON UPDATE no action ON DELETE cascade,
                    FOREIGN KEY ('orgId') REFERENCES 'orgs'('orgId') ON UPDATE no action ON DELETE cascade,
                    FOREIGN KEY ('roleId') REFERENCES 'roles'('roleId') ON UPDATE no action ON DELETE cascade
                );
                `
            ).run();
            db.prepare(
                `
                CREATE INDEX 'idx_clientOrgRoles_roleId' ON 'clientOrgRoles' ('roleId');
                `
            ).run();
            db.prepare(
                `
                CREATE UNIQUE INDEX 'clientOrgRoles_clientId_orgId_roleId_unique' ON 'clientOrgRoles' ('clientId','orgId','roleId');
                `
            ).run();
            db.prepare(
                `
                CREATE TABLE 'redirects' (
                    'redirectId' integer PRIMARY KEY AUTOINCREMENT NOT NULL,
                    'orgId' text NOT NULL,
                    'resourceId' integer,
                    'domainId' text,
                    'niceId' text NOT NULL,
                    'name' text NOT NULL,
                    'subdomain' text,
                    'destinationHost' text NOT NULL,
                    'pathMatchType' text DEFAULT 'regex' NOT NULL,
                    'matchPath' text,
                    'rewritePath' text,
                    'rewritePathType' text,
                    'priority' integer DEFAULT 100,
                    'permanent' integer DEFAULT false NOT NULL,
                    'ssl' integer DEFAULT true NOT NULL,
                    'enabled' integer DEFAULT true NOT NULL,
                    FOREIGN KEY ('orgId') REFERENCES 'orgs'('orgId') ON UPDATE no action ON DELETE cascade,
                    FOREIGN KEY ('resourceId') REFERENCES 'resources'('resourceId') ON UPDATE no action ON DELETE cascade,
                    FOREIGN KEY ('domainId') REFERENCES 'domains'('domainId') ON UPDATE no action ON DELETE cascade
                );
                `
            ).run();
            db.prepare(
                `
                ALTER TABLE 'exitNodes' ADD 'relayPort' integer DEFAULT 21820 NOT NULL;
                `
            ).run();
            db.prepare(
                `
                ALTER TABLE 'resources' ADD 'loadBalancingStrategy' text DEFAULT 'wrr' NOT NULL;
                `
            ).run();
            db.prepare(
                `
                ALTER TABLE 'resources' ADD 'mtlsEnabled' integer DEFAULT false NOT NULL;
                `
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
