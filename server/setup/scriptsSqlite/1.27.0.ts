import { APP_PATH } from "@server/lib/consts";
import Database from "better-sqlite3";
import path from "path";

const version = "1.27.0";

export default async function migration() {
    console.log(`Running setup script ${version}...`);

    const location = path.join(APP_PATH, "db", "db.sqlite");
    const db = new Database(location);

    try {
        db.transaction(() => {
            db.prepare(
                `
                CREATE TABLE 'alertLabels' (
                    'alertRuleId' integer NOT NULL,
                    'labelId' integer NOT NULL,
                    FOREIGN KEY ('alertRuleId') REFERENCES 'alertRules'('alertRuleId') ON UPDATE no action ON DELETE cascade,
                    FOREIGN KEY ('labelId') REFERENCES 'labels'('labelId') ON UPDATE no action ON DELETE cascade
                );
                `
            ).run();

            db.prepare(
                `
                CREATE TABLE 'roleClientSettings' (
                    'roleId' integer PRIMARY KEY NOT NULL,
                    'orgId' text NOT NULL,
                    'enabled' integer DEFAULT false NOT NULL,
                    'overrideDns' integer,
                    'mtu' integer,
                    'tunnelDns' integer,
                    'primaryDns' text,
                    'secondaryDns' text,
                    'exitNodeTakesPrecedence' integer,
                    'exitNodeSiteResourceId' integer,
                    'exitNodeLocked' integer DEFAULT false NOT NULL,
                    'matchDomains' text,
                    'preferLocalRoutes' integer,
                    FOREIGN KEY ('roleId') REFERENCES 'roles'('roleId') ON UPDATE no action ON DELETE cascade,
                    FOREIGN KEY ('orgId') REFERENCES 'orgs'('orgId') ON UPDATE no action ON DELETE cascade,
                    FOREIGN KEY ('exitNodeSiteResourceId') REFERENCES 'siteResources'('siteResourceId') ON UPDATE no action ON DELETE set null
                );
                `
            ).run();
        })();

        console.log("Migrated database");
    } catch (e) {
        console.log("Failed to migrate db:", e);
        throw e;
    }

    console.log(`${version} migration complete`);
}
