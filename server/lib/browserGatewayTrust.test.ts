import { assertEquals } from "@test/assert";
import {
    BROWSER_GATEWAY_TRUST_HEADER,
    buildPHostHeaders,
    deriveBrowserGatewayTrustToken
} from "./browserGatewayTrust";

function testBuildPHostHeaders() {
    console.log("Running p-host trust header test...");
    const withSecret = buildPHostHeaders("s3cret", "app.example.com");
    assertEquals(withSecret["p-host"], "app.example.com", "p-host is set");
    assertEquals(
        withSecret[BROWSER_GATEWAY_TRUST_HEADER],
        deriveBrowserGatewayTrustToken("s3cret"),
        "trust token is stamped"
    );
    assertEquals(
        deriveBrowserGatewayTrustToken("a") ===
            deriveBrowserGatewayTrustToken("b"),
        false,
        "tokens differ per secret"
    );

    const noSecret = buildPHostHeaders(undefined, "app.example.com");
    assertEquals(
        BROWSER_GATEWAY_TRUST_HEADER in noSecret,
        false,
        "no token without a secret"
    );
}

try {
    testBuildPHostHeaders();
    console.log("All browser gateway trust tests passed!");
} catch (error) {
    console.error("Test failed:", error);
    process.exit(1);
}
