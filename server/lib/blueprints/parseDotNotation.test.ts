import { assertEquals } from "@test/assert";
import { setNestedProperty } from "./parseDotNotation";
import { processContainerLabels } from "./parseDockerContainers";

function testPrototypePollutionBlocked() {
    console.log("Running Docker label prototype pollution test...");
    const paths = [
        "resources.__proto__.polluted.orgId",
        "resources.app.__proto__.polluted",
        "resources.app.constructor.prototype.polluted",
        "resources.__proto__[0].polluted",
        "__proto__.polluted"
    ];
    for (const path of paths) {
        setNestedProperty({}, path, "x");
        assertEquals(
            ({} as any).polluted,
            undefined,
            `${path} does not reach Object.prototype`
        );
    }

    processContainerLabels([
        {
            id: "c",
            name: "c",
            image: "i",
            state: "running",
            status: "",
            ports: null,
            created: 0,
            networks: {},
            hostname: "c",
            labels: {
                "pangolin.public-resources.__proto__.apiKeyOrg.orgId": "x",
                "pangolin.private-resources.app.__proto__.apiKeyOrg.orgId": "x"
            }
        }
    ]);
    assertEquals(
        ({} as any).apiKeyOrg,
        undefined,
        "container labels cannot set Object.prototype.apiKeyOrg"
    );

    const ok: any = {};
    setNestedProperty(ok, "resources.app.targets[0].port", "80");
    assertEquals(
        ok.resources.app.targets[0].port,
        80,
        "normal paths still work"
    );
}

try {
    testPrototypePollutionBlocked();
    console.log("All parseDotNotation tests passed!");
} catch (error) {
    console.error("Test failed:", error);
    process.exit(1);
}
