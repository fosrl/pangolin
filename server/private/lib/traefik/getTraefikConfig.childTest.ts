// Test child for getTraefikConfig.test.ts. Boots the real sqlite driver
// against a fresh database in the temp workdir (cwd), seeds two domains (one
// holding three certificate rows, one holding a single certificate row), two
// tcp resources and one http resource, calls getTraefikConfig, and prints one
// JSON line of observations.
// The app boots with `import "./extendZod"` before anything else; zod
// schemas in the import chain use .openapi(), so do the same here.
import "@server/extendZod";
import { getTraefikConfig } from "#private/lib/traefik/getTraefikConfig";
import {
    certificates,
    db,
    domains,
    exitNodes,
    orgs,
    resources,
    sites,
    targets
} from "@server/db";

async function main() {
    const now = Math.floor(Date.now() / 1000);

    await db.insert(exitNodes).values({
        exitNodeId: 1,
        name: "en",
        address: "10.0.0.1",
        endpoint: "10.0.0.1:51820",
        publicKey: "enKey",
        listenPort: 51820,
        reachableAt: "http://127.0.0.1:9",
        type: "gerbil"
    });
    await db.insert(orgs).values({
        orgId: "org1",
        name: "Org",
        settingsJitModeLimit: 1
    });
    await db.insert(domains).values([
        { domainId: "d-multi", baseDomain: "multi.example.com" },
        { domainId: "d-single", baseDomain: "single.example.com" }
    ]);
    await db.insert(sites).values({
        siteId: 1,
        orgId: "org1",
        niceId: "1",
        name: "wg1",
        pubKey: "wgKey1",
        exitNodeId: 1,
        type: "wireguard",
        online: true
    });
    await db.insert(resources).values([
        {
            resourceId: 1,
            orgId: "org1",
            niceId: "1",
            name: "pg",
            mode: "tcp",
            subdomain: "pg",
            fullDomain: "pg.multi.example.com",
            domainId: "d-multi",
            proxyPort: 15432
        },
        {
            resourceId: 2,
            orgId: "org1",
            niceId: "2",
            name: "ssh",
            mode: "tcp",
            subdomain: "ssh",
            fullDomain: "ssh.single.example.com",
            domainId: "d-single",
            proxyPort: 12222
        },
        {
            resourceId: 3,
            orgId: "org1",
            niceId: "3",
            name: "web",
            mode: "http",
            subdomain: "web",
            fullDomain: "web.multi.example.com",
            domainId: "d-multi",
            proxyPort: 80
        }
    ]);
    await db.insert(targets).values([
        {
            targetId: 1,
            resourceId: 1,
            siteId: 1,
            ip: "10.9.9.9",
            port: 5432,
            enabled: true,
            priority: 100
        },
        {
            targetId: 2,
            resourceId: 2,
            siteId: 1,
            ip: "10.8.8.8",
            port: 2222,
            enabled: true,
            priority: 100
        },
        {
            targetId: 3,
            resourceId: 3,
            siteId: 1,
            ip: "10.7.7.7",
            method: "http",
            port: 8080,
            enabled: true,
            priority: 100
        }
    ]);
    // One certificates row per hostname, like the `certificates_domain_unique`
    // constraint produces in production: three rows share d-multi, one row
    // sits on d-single.
    await db.insert(certificates).values([
        {
            domain: "pg.multi.example.com",
            domainId: "d-multi",
            status: "valid",
            createdAt: now,
            updatedAt: now
        },
        {
            domain: "web.multi.example.com",
            domainId: "d-multi",
            status: "valid",
            createdAt: now,
            updatedAt: now
        },
        {
            domain: "other.multi.example.com",
            domainId: "d-multi",
            status: "valid",
            createdAt: now,
            updatedAt: now
        },
        {
            domain: "ssh.single.example.com",
            domainId: "d-single",
            status: "valid",
            createdAt: now,
            updatedAt: now
        }
    ]);

    const cfg = await getTraefikConfig(1, ["newt", "wireguard", "local"]);

    const tcpServices: Record<string, string[]> = {};
    for (const [name, service] of Object.entries<any>(
        cfg?.tcp?.services ?? {}
    )) {
        tcpServices[name] = (service?.loadBalancer?.servers ?? []).map(
            (server: any) => String(server?.address ?? "")
        );
    }
    const httpServices: Record<string, string[]> = {};
    for (const [name, service] of Object.entries<any>(
        cfg?.http?.services ?? {}
    )) {
        httpServices[name] = (service?.loadBalancer?.servers ?? []).map(
            (server: any) => String(server?.url ?? "")
        );
    }

    console.log(
        "OBSERVATIONS " + JSON.stringify({ tcpServices, httpServices })
    );
    // The import chain keeps cache/license timers alive, so exit explicitly
    // once the observations are printed.
    process.exit(0);
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
