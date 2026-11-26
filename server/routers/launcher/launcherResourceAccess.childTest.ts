// Test child for launcherResourceAccess.test.ts. Boots the real sqlite driver
// against a fresh database in the temp workdir (cwd), seeds resources covering
// every policy shape the launcher visibility rules care about, and prints the
// accessible ids as one JSON line.
// The app boots with `import "./extendZod"` before anything else; zod schemas
// in the import chain use .openapi(), so do the same here.
import "@server/extendZod";
import { resolveAccessibleIds } from "@server/routers/launcher/launcherResourceAccess";
import { db, orgs, resourcePolicies, resources } from "@server/db";

async function seed() {
    await db.insert(orgs).values([
        { orgId: "org1", name: "Org" },
        { orgId: "org2", name: "Other org" }
    ]);

    await db.insert(resourcePolicies).values([
        {
            resourcePolicyId: 1,
            sso: false,
            niceId: "shared-open",
            name: "Shared open",
            orgId: "org1"
        },
        {
            resourcePolicyId: 2,
            sso: true,
            niceId: "shared-sso",
            name: "Shared sso",
            orgId: "org1"
        },
        {
            resourcePolicyId: 3,
            sso: false,
            niceId: "default-open",
            name: "Default open",
            orgId: "org1"
        },
        {
            resourcePolicyId: 4,
            sso: true,
            niceId: "default-sso",
            name: "Default sso",
            orgId: "org1"
        }
    ]);

    await db.insert(resources).values([
        // 1: shared policy without SSO -> visible without any assignment
        {
            resourceId: 1,
            orgId: "org1",
            niceId: "r1",
            name: "Shared open",
            resourcePolicyId: 1
        },
        // 2: default policy without SSO -> visible
        {
            resourceId: 2,
            orgId: "org1",
            niceId: "r2",
            name: "Default open",
            defaultResourcePolicyId: 3
        },
        // 3: shared policy with SSO -> hidden
        {
            resourceId: 3,
            orgId: "org1",
            niceId: "r3",
            name: "Shared sso",
            resourcePolicyId: 2
        },
        // 4: default policy with SSO -> hidden
        {
            resourceId: 4,
            orgId: "org1",
            niceId: "r4",
            name: "Default sso",
            defaultResourcePolicyId: 4
        },
        // 5: no policy at all -> visible
        {
            resourceId: 5,
            orgId: "org1",
            niceId: "r5",
            name: "No policy"
        },
        // 6: blocking access overrides the non-SSO visibility
        {
            resourceId: 6,
            orgId: "org1",
            niceId: "r6",
            name: "Blocked",
            resourcePolicyId: 1,
            blockAccess: true
        },
        // 7: disabled resources never show up
        {
            resourceId: 7,
            orgId: "org1",
            niceId: "r7",
            name: "Disabled",
            resourcePolicyId: 1,
            enabled: false
        },
        // 8: unapproved resources never show up
        {
            resourceId: 8,
            orgId: "org1",
            niceId: "r8",
            name: "Pending",
            resourcePolicyId: 1,
            status: "pending"
        },
        // 9: another org's resources never show up
        {
            resourceId: 9,
            orgId: "org2",
            niceId: "r9",
            name: "Other org"
        },
        // 10: the shared policy wins over the default policy -> visible
        {
            resourceId: 10,
            orgId: "org1",
            niceId: "r10",
            name: "Shared open over default sso",
            resourcePolicyId: 1,
            defaultResourcePolicyId: 4
        },
        // 11: the shared policy wins over the default policy -> hidden
        {
            resourceId: 11,
            orgId: "org1",
            niceId: "r11",
            name: "Shared sso over default open",
            resourcePolicyId: 2,
            defaultResourcePolicyId: 3
        }
    ]);
}

seed()
    .then(() => resolveAccessibleIds("org1", "user1", []))
    .then((accessible) => {
        console.log(
            "OBSERVATIONS " +
                JSON.stringify({
                    resourceIds: [...accessible.resourceIds].sort(
                        (a, b) => a - b
                    ),
                    siteResourceIds: accessible.siteResourceIds
                })
        );
        process.exit(0);
    })
    .catch((e: unknown) => {
        console.error("CHILD_FAIL", e instanceof Error ? e.message : String(e));
        process.exit(1);
    });
