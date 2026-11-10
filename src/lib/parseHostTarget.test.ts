import { assertEqualsObj } from "@test/assert";
import { parseHostTarget } from "./parseHostTarget";

function runTests() {
    assertEqualsObj(
        parseHostTarget("https://example.com:8443"),
        { protocol: "https", host: "example.com", port: 8443 },
        "A lowercase scheme and port should be read as given"
    );
    assertEqualsObj(
        parseHostTarget("example.com:8080"),
        { protocol: "http", host: "example.com", port: 8080 },
        "A target without a scheme should default to http"
    );
    assertEqualsObj(
        parseHostTarget("https://example.com"),
        { protocol: "https", host: "example.com", port: 443 },
        "An https target without a port should use 443"
    );
    assertEqualsObj(
        parseHostTarget("Https://example.com:8443"),
        { protocol: "https", host: "example.com", port: 8443 },
        "A capitalized scheme should not become the host"
    );
    assertEqualsObj(
        parseHostTarget("HTTP://10.0.0.5:3000"),
        { protocol: "http", host: "10.0.0.5", port: 3000 },
        "An uppercase http scheme should be recognized"
    );
    assertEqualsObj(
        parseHostTarget("H2C://backend:50051"),
        { protocol: "h2c", host: "backend", port: 50051 },
        "An uppercase h2c scheme should be recognized"
    );
    console.log("All parseHostTarget tests passed");
}

runTests();
