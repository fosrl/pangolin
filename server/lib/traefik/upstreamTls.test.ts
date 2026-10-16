import { assertEqualsObj } from "@test/assert";
import {
    attachUpstreamTlsTransport,
    buildUpstreamTlsTransport
} from "./upstreamTls";

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

    for (const verifyUpstreamTls of [false, true]) {
        const config = {
            http: {
                services: {
                    "backend-service": {
                        loadBalancer: {}
                    }
                },
                serversTransports: {} as Record<
                    string,
                    {
                        serverName: string;
                        insecureSkipVerify: boolean;
                    }
                >
            }
        };

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
            {
                serversTransport: "backend-transport"
            },
            "The load balancer should reference the generated transport"
        );
    }

    const configWithoutSni = {
        http: {
            services: {
                "backend-service": {
                    loadBalancer: {}
                }
            }
        }
    };

    attachUpstreamTlsTransport(
        configWithoutSni,
        "backend-service",
        "backend-transport",
        null,
        false
    );

    assertEqualsObj(
        configWithoutSni,
        {
            http: {
                services: {
                    "backend-service": {
                        loadBalancer: {}
                    }
                }
            }
        },
        "No custom transport should be created without an SNI hostname"
    );

    console.log("All upstream TLS transport tests passed!");
}

runTests();
