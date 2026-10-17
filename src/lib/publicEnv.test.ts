import { assertEquals, assertEqualsObj } from "@test/assert";
import { Env } from "./types/env";
import { sanitizeEnvForAnonymousClient } from "./publicEnv";

function fullEnv(): Env {
    return {
        server: {
            nextPort: "3002",
            externalPort: "3000",
            sessionCookieName: "p_session",
            resourceAccessTokenParam: "p_at",
            resourceSessionRequestParam: "p_session_request",
            resourceAccessTokenHeadersId: "P-Access-Token-Id",
            resourceAccessTokenHeadersToken: "P-Access-Token",
            reoClientId: "reo-client",
            maxmind_db_path: "/var/geodb/city.mmdb",
            maxmind_asn_path: "/var/geodb/asn.mmdb"
        },
        app: {
            environment: "prod",
            sandbox_mode: false,
            version: "1.24.0",
            dashboardUrl: "https://pangolin.example.com",
            notifications: {
                product_updates: true,
                new_releases: true
            },
            identityProviderMode: "org"
        },
        email: {
            emailEnabled: true
        },
        flags: {
            disableSignupWithoutInvite: false,
            disableUserCreateOrg: false,
            emailVerificationRequired: false,
            allowRawResources: false,
            disableLocalSites: false,
            disableBasicWireguardSites: false,
            hideSupporterKey: false,
            usePangolinDns: false,
            disableProductHelpBanners: false,
            disableEnterpriseFeatures: false,
            disableVirtualApiKeysUi: false
        },
        branding: {
            appName: "Pangolin",
            loginPage: {
                subtitleText: ""
            },
            signupPage: {
                subtitleText: ""
            },
            resourceAuthPage: {
                showLogo: true,
                hidePoweredBy: false,
                titleText: "",
                subtitleText: ""
            }
        }
    };
}

function runTests() {
    const sanitized = sanitizeEnvForAnonymousClient(fullEnv());

    assertEquals(
        sanitized.app.version,
        "",
        "The exact server version must not reach an anonymous client"
    );
    assertEquals(
        sanitized.server.nextPort,
        "",
        "The internal Next port must not reach an anonymous client"
    );
    assertEquals(
        sanitized.server.externalPort,
        "",
        "The external listener port must not reach an anonymous client"
    );
    assertEquals(
        sanitized.server.maxmind_db_path,
        "",
        "The maxmind db path must not reach an anonymous client"
    );
    assertEquals(
        sanitized.server.maxmind_asn_path,
        "",
        "The maxmind asn path must not reach an anonymous client"
    );

    assertEqualsObj(
        {
            sessionCookieName: sanitized.server.sessionCookieName,
            resourceAccessTokenParam: sanitized.server.resourceAccessTokenParam,
            resourceSessionRequestParam:
                sanitized.server.resourceSessionRequestParam,
            resourceAccessTokenHeadersId:
                sanitized.server.resourceAccessTokenHeadersId,
            resourceAccessTokenHeadersToken:
                sanitized.server.resourceAccessTokenHeadersToken,
            reoClientId: sanitized.server.reoClientId,
            environment: sanitized.app.environment,
            sandbox_mode: sanitized.app.sandbox_mode,
            dashboardUrl: sanitized.app.dashboardUrl,
            emailEnabled: sanitized.email.emailEnabled,
            appName: sanitized.branding.appName
        },
        {
            sessionCookieName: "p_session",
            resourceAccessTokenParam: "p_at",
            resourceSessionRequestParam: "p_session_request",
            resourceAccessTokenHeadersId: "P-Access-Token-Id",
            resourceAccessTokenHeadersToken: "P-Access-Token",
            reoClientId: "reo-client",
            environment: "prod",
            sandbox_mode: false,
            dashboardUrl: "https://pangolin.example.com",
            emailEnabled: true,
            appName: "Pangolin"
        },
        "Everything an anonymous client actually needs must survive sanitization unchanged"
    );

    const original = fullEnv();
    assertEquals(
        original.app.version,
        "1.24.0",
        "Sanitization must not mutate the caller's env object"
    );
    assertEquals(
        original.server.maxmind_db_path,
        "/var/geodb/city.mmdb",
        "Sanitization must not mutate the caller's env object"
    );
}

try {
    runTests();
} catch (error) {
    console.error("publicEnv sanitization test failed:", error);
    process.exit(1);
}
