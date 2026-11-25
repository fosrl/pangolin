import { assertEqualsObj } from "@test/assert";
import {
    attachUpstreamTlsTransport,
    buildUpstreamTlsTransport
} from "./upstreamTls";

const CA_PEM = "-----BEGIN CERTIFICATE-----\nTEST\n-----END CERTIFICATE-----\n";

function createConfig() {
    return {
        http: {
            services: {
                "backend-service": {
                    loadBalancer: {} as { serversTransport?: string }
                }
            },
            serversTransports: {} as Record<
                string,
                ReturnType<typeof buildUpstreamTlsTransport>
            >
        }
    };
}

function runTests() {
    console.log("Running upstream TLS transport tests...");

    assertEqualsObj(
        buildUpstreamTlsTransport("backend.example.com", false),
        {
            serverName: "backend.example.com",
            insecureSkipVerify: true
        },
        "TLS verification should be disabled by default"
    );

    assertEqualsObj(
        buildUpstreamTlsTransport("backend.example.com", true),
        {
            serverName: "backend.example.com",
            insecureSkipVerify: false
        },
        "TLS verification should be enabled when requested"
    );

    assertEqualsObj(
        buildUpstreamTlsTransport("backend.example.com", true, CA_PEM),
        {
            serverName: "backend.example.com",
            insecureSkipVerify: false,
            rootCAs: [CA_PEM]
        },
        "A verified upstream should trust its configured CA"
    );

    assertEqualsObj(
        buildUpstreamTlsTransport(null, true, CA_PEM),
        {
            insecureSkipVerify: false,
            rootCAs: [CA_PEM]
        },
        "Custom CA verification must not require a custom SNI hostname"
    );

    assertEqualsObj(
        buildUpstreamTlsTransport(null, true),
        { insecureSkipVerify: false },
        "TLS verification should be available without a custom SNI hostname"
    );

    assertEqualsObj(
        buildUpstreamTlsTransport("backend.example.com", false, CA_PEM),
        {
            serverName: "backend.example.com",
            insecureSkipVerify: true
        },
        "A stored CA must not be activated while verification is disabled"
    );

    for (const verifyUpstreamTls of [false, true]) {
        const config = createConfig();

        attachUpstreamTlsTransport(
            config,
            "backend-service",
            "backend-transport",
            "backend.example.com",
            verifyUpstreamTls
        );

        assertEqualsObj(
            config.http.serversTransports["backend-transport"],
            {
                serverName: "backend.example.com",
                insecureSkipVerify: !verifyUpstreamTls
            },
            "The transport should use the configured verification setting"
        );

        assertEqualsObj(
            config.http.services["backend-service"].loadBalancer,
            { serversTransport: "backend-transport" },
            "The load balancer should reference the generated transport"
        );
    }

    const configWithoutSni = createConfig();
    attachUpstreamTlsTransport(
        configWithoutSni,
        "backend-service",
        "backend-transport",
        null,
        false,
        CA_PEM
    );
    assertEqualsObj(
        configWithoutSni,
        createConfig(),
        "No transport should be created for an unverified resource without SNI"
    );

    const verifiedWithoutSni = createConfig();
    attachUpstreamTlsTransport(
        verifiedWithoutSni,
        "backend-service",
        "backend-transport",
        null,
        true,
        CA_PEM
    );
    assertEqualsObj(
        verifiedWithoutSni.http.serversTransports["backend-transport"],
        { insecureSkipVerify: false, rootCAs: [CA_PEM] },
        "A CA-only transport should be generated with verification enabled"
    );
    assertEqualsObj(
        verifiedWithoutSni.http.services["backend-service"].loadBalancer,
        { serversTransport: "backend-transport" },
        "A CA-only transport must be attached to the service"
    );

    // Custom server names are optional and whitespace must not become SNI.
    assertEqualsObj(
        buildUpstreamTlsTransport("  backend.example.com  ", true, CA_PEM),
        {
            serverName: "backend.example.com",
            insecureSkipVerify: false,
            rootCAs: [CA_PEM]
        },
        "SNI should be trimmed when set"
    );

    for (const ca of [null, "", "   "]) {
        assertEqualsObj(
            buildUpstreamTlsTransport(null, true, ca),
            { insecureSkipVerify: false },
            "An empty CA must not create a rootCAs entry"
        );
    }

    assertEqualsObj(
        buildUpstreamTlsTransport("   ", true, CA_PEM),
        { insecureSkipVerify: false, rootCAs: [CA_PEM] },
        "TLS verification with a CA must work without custom SNI"
    );

    const unverifiedWithoutSni = createConfig();
    attachUpstreamTlsTransport(
        unverifiedWithoutSni,
        "backend-service",
        "backend-transport",
        "  ",
        false,
        CA_PEM
    );
    assertEqualsObj(
        unverifiedWithoutSni,
        createConfig(),
        "Whitespace-only SNI must preserve the default transport"
    );

    const verifiedWithoutCa = createConfig();
    attachUpstreamTlsTransport(
        verifiedWithoutCa,
        "backend-service",
        "backend-transport",
        null,
        true
    );
    assertEqualsObj(
        verifiedWithoutCa.http.serversTransports["backend-transport"],
        { insecureSkipVerify: false },
        "Verification without SNI or custom CA still requires a transport"
    );
    assertEqualsObj(
        verifiedWithoutCa.http.services["backend-service"].loadBalancer,
        { serversTransport: "backend-transport" },
        "Verification without SNI or custom CA must attach the transport"
    );

    const configWithoutTransportMap: Parameters<
        typeof attachUpstreamTlsTransport
    >[0] = {
        http: {
            services: {
                "backend-service": {
                    loadBalancer: {} as { serversTransport?: string }
                }
            }
        }
    };
    attachUpstreamTlsTransport(
        configWithoutTransportMap,
        "backend-service",
        "backend-transport",
        null,
        true,
        CA_PEM
    );
    assertEqualsObj(
        configWithoutTransportMap.http,
        {
            services: {
                "backend-service": {
                    loadBalancer: { serversTransport: "backend-transport" }
                }
            },
            serversTransports: {
                "backend-transport": {
                    insecureSkipVerify: false,
                    rootCAs: [CA_PEM]
                }
            }
        },
        "The serversTransports map must be created when absent"
    );

    // Avoid modifying other resources' transport configuration.
    const independentServices = createConfig();
    independentServices.http.services["backend-service"].loadBalancer = {
        serversTransport: "previous-transport"
    };
    independentServices.http.serversTransports["previous-transport"] = {
        serverName: "other.example.com",
        insecureSkipVerify: false
    };
    attachUpstreamTlsTransport(
        independentServices,
        "backend-service",
        "backend-transport",
        null,
        true,
        CA_PEM
    );
    assertEqualsObj(
        independentServices.http.serversTransports["previous-transport"],
        { serverName: "other.example.com", insecureSkipVerify: false },
        "Adding a new transport must preserve existing transports"
    );
    assertEqualsObj(
        independentServices.http.services["backend-service"].loadBalancer,
        { serversTransport: "backend-transport" },
        "Only the selected service must reference the new transport"
    );

    console.log("All upstream TLS transport tests passed!");
}

runTests();
