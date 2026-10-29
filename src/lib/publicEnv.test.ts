import { assertEquals, assertEqualsObj } from "@test/assert";
import { Env } from "./types/env";
import {
    sanitizeEnvForClientPayload,
    resolveClientApiBaseUrl
} from "./publicEnv";

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

function runSanitizeTests() {
    // Proxied request: no port in the Host header.
    const proxied = sanitizeEnvForClientPayload(
        fullEnv(),
        "pangolin.example.com"
    );

    assertEquals(
        proxied.app.version,
        "",
        "The exact server version must not reach a client through a proxy"
    );
    assertEquals(
        proxied.server.nextPort,
        "",
        "The internal Next port must not reach a client through a proxy"
    );
    assertEquals(
        proxied.server.externalPort,
        "",
        "The external listener port must not reach a client through a proxy"
    );
    assertEquals(
        proxied.server.maxmind_db_path,
        "",
        "The maxmind db path must not reach a client through a proxy"
    );
    assertEquals(
        proxied.server.maxmind_asn_path,
        "",
        "The maxmind asn path must not reach a client through a proxy"
    );

    // Proxied request on a default port: "443" is a port, but not the
    // Next port, so it must not keep the listener ports in the payload.
    const proxiedDefaultPort = sanitizeEnvForClientPayload(
        fullEnv(),
        "pangolin.example.com:443"
    );
    assertEquals(
        proxiedDefaultPort.server.nextPort,
        "",
        "A default port in the Host header must not keep the internal ports in the payload"
    );

    // No Host header at all: fail closed.
    const noHost = sanitizeEnvForClientPayload(fullEnv(), null);
    assertEquals(
        noHost.server.nextPort,
        "",
        "A missing Host header must fail closed"
    );

    // A request that arrived on the external port only: that is not the
    // direct-Next access mode, so the ports stay internal.
    const externalOnly = sanitizeEnvForClientPayload(
        fullEnv(),
        "localhost:3000"
    );
    assertEquals(
        externalOnly.server.nextPort,
        "",
        "Arriving on the external port must not keep the internal ports in the payload"
    );

    // Direct-Next access: the request itself arrived on nextPort, so the
    // visitor already knows that port and needs externalPort to reach
    // the API. The ports are kept - but the version and the GeoIP paths
    // are still stripped: direct access is not authentication.
    const direct = sanitizeEnvForClientPayload(fullEnv(), "localhost:3002");
    assertEquals(
        direct.server.nextPort,
        "3002",
        "A request that arrived on the Next port itself already knows it, so it may be kept"
    );
    assertEquals(
        direct.server.externalPort,
        "3000",
        "Direct-Next access needs the external port to reach the API, so it is kept"
    );
    assertEquals(
        direct.app.version,
        "",
        "Direct-Next access is not authentication: the version must still be stripped"
    );
    assertEquals(
        direct.server.maxmind_db_path,
        "",
        "Direct-Next access is not authentication: the GeoIP paths must still be stripped"
    );

    // IPv6 host on the Next port.
    const directV6 = sanitizeEnvForClientPayload(fullEnv(), "[::1]:3002");
    assertEquals(
        directV6.server.externalPort,
        "3000",
        "An IPv6 request that arrived on the Next port keeps the external port"
    );

    // Everything a client genuinely needs survives sanitization.
    assertEqualsObj(
        {
            sessionCookieName: proxied.server.sessionCookieName,
            resourceAccessTokenParam: proxied.server.resourceAccessTokenParam,
            resourceSessionRequestParam:
                proxied.server.resourceSessionRequestParam,
            resourceAccessTokenHeadersId:
                proxied.server.resourceAccessTokenHeadersId,
            resourceAccessTokenHeadersToken:
                proxied.server.resourceAccessTokenHeadersToken,
            reoClientId: proxied.server.reoClientId,
            environment: proxied.app.environment,
            sandbox_mode: proxied.app.sandbox_mode,
            dashboardUrl: proxied.app.dashboardUrl,
            emailEnabled: proxied.email.emailEnabled,
            appName: proxied.branding.appName
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
        "Everything a client actually needs must survive sanitization unchanged"
    );

    // Sanitization must not mutate the caller's env object.
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

function runResolverTests() {
    const browserOnNextPort = {
        port: "3002",
        protocol: "https:",
        hostname: "192.168.1.10"
    };
    const browserOnDefaultPort = {
        port: "",
        protocol: "https:",
        hostname: "pangolin.example.com"
    };

    // Authenticated shell: full env, direct access mode unchanged.
    const full = resolveClientApiBaseUrl({
        env: fullEnv(),
        windowLocation: browserOnNextPort
    });
    assertEquals(
        full.baseURL,
        "https://192.168.1.10:3000/api/v1",
        "Direct-Next access must keep building the external-port URL"
    );
    assertEquals(
        full.directAccess,
        true,
        "Direct-Next access must be flagged so withCredentials is set"
    );

    // Authenticated shell behind the proxy: full env, public URL.
    const fullProxied = resolveClientApiBaseUrl({
        env: fullEnv(),
        windowLocation: browserOnDefaultPort
    });
    assertEquals(
        fullProxied.baseURL,
        "https://pangolin.example.com/api/v1",
        "A proxied browser with the full env must use the dashboard URL"
    );

    // The sanitized env of a proxied request, on default ports: the
    // empty nextPort must never match, even though the browser's port
    // is also empty. The old inline comparison took the direct branch
    // here and built "https://<current host>:/api/v1".
    const sanitizedProxied = sanitizeEnvForClientPayload(
        fullEnv(),
        "pangolin.example.com"
    );
    const onDefaultPort = resolveClientApiBaseUrl({
        env: sanitizedProxied,
        windowLocation: browserOnDefaultPort
    });
    assertEquals(
        onDefaultPort.baseURL,
        "https://pangolin.example.com/api/v1",
        "An empty nextPort must never take the direct branch, including on default ports"
    );
    assertEquals(
        onDefaultPort.directAccess,
        false,
        "An empty nextPort must never be treated as direct access"
    );

    // Sanitized env of a proxied request, but the browser somehow sits
    // on the Next port: still no match, the ports were not handed out.
    const onNextPort = resolveClientApiBaseUrl({
        env: sanitizedProxied,
        windowLocation: browserOnNextPort
    });
    assertEquals(
        onNextPort.baseURL,
        "https://pangolin.example.com/api/v1",
        "A blanked nextPort must not match even when the browser port would have"
    );

    // The sanitized env of a DIRECT request keeps the ports, so an
    // anonymous visitor on the Next port still reaches the API through
    // the external port - the login flow keeps working in that mode.
    const sanitizedDirect = sanitizeEnvForClientPayload(
        fullEnv(),
        "192.168.1.10:3002"
    );
    const directLogin = resolveClientApiBaseUrl({
        env: sanitizedDirect,
        windowLocation: browserOnNextPort
    });
    assertEquals(
        directLogin.baseURL,
        "https://192.168.1.10:3000/api/v1",
        "An anonymous visitor on the Next port must keep a working API base URL"
    );
    assertEquals(
        directLogin.directAccess,
        true,
        "An anonymous visitor on the Next port is still in direct access mode"
    );
}

try {
    runSanitizeTests();
    runResolverTests();
} catch (error) {
    console.error("publicEnv client payload test failed:", error);
    process.exit(1);
}

console.log("publicEnv client payload tests passed");
