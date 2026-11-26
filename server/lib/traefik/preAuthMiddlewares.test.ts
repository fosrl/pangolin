import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { configSchema } from "../readConfigFile";
import type { BrowserGatewayResourceEntry } from "./browserGateway";
import type { RedirectRouteRow } from "./redirect";

// Test the actual route builders without booting the config singleton and database.
const fixtures = new Map([
    [
        "@server/lib/config",
        "export function set(raw) { current = raw } let current; export default { getRawConfig: () => current };"
    ],
    [
        "@server/db",
        "export const alias = null, db = null, resourceMtlsCertificates = null, resourcePolicies = null, resourcePolicyMtlsCertificates = null, resources = null;"
    ],
    ["@server/logger", "export default { debug() {} };"]
]);
const hooks = registerHooks({
    resolve(specifier, context, nextResolve) {
        const fixture = fixtures.get(specifier);
        return fixture
            ? {
                  shortCircuit: true,
                  url: "data:text/javascript," + encodeURIComponent(fixture)
              }
            : nextResolve(specifier, context);
    }
});

try {
    const config = (await import("@server/lib/config")) as unknown as {
        set: (config: unknown) => void;
    };
    const { buildBrowserGatewayConfig } = await import("./browserGateway");
    const { buildRedirectConfig } = await import("./redirect");

    const preAuth = ["first@file", "second@kubernetescrd"];
    const badger = "badger";
    const postAuth = "existing@file";
    const redirectHttps = "redirect-to-https";
    const tls = { certResolver: "letsencrypt" };
    const mtls = { ...tls, options: "resource-1-mtls" };
    const mtlsCaCertsByResource = new Map([[1, ["test-client-ca"]]]);

    function configure(pre_auth_middlewares?: string[]) {
        const traefik = configSchema.shape.traefik.parse({
            pre_auth_middlewares,
            additional_middlewares: [postAuth]
        });
        config.set({ traefik, server: { secret: "test-signing-key" } });
        return traefik;
    }

    function makeGateway(
        maintenanceModeType: "forced" | "automatic",
        siteOnline: boolean
    ) {
        const gateway: BrowserGatewayResourceEntry = {
            resourceId: 1,
            name: "gateway",
            fullDomain: "gateway.example.test",
            ssl: true,
            subdomain: "gateway",
            domainId: "test",
            enabled: true,
            wildcard: false,
            domainCertResolver: null,
            preferWildcardCert: false,
            maintenanceModeEnabled: true,
            maintenanceModeType,
            maintenanceTitle: null,
            maintenanceMessage: null,
            maintenanceEstimatedTime: null,
            targets: [
                {
                    targetId: 1,
                    bgType: "ssh",
                    siteId: 1,
                    siteType: "newt",
                    siteOnline,
                    subnet: "100.64.0.1/32"
                }
            ]
        };
        const output = { http: { routers: {} } };
        buildBrowserGatewayConfig({
            config_output: output,
            browserGatewayResourcesMap: new Map([[1, gateway]]),
            mtlsCaCertsByResource,
            browserGatewayUiUrl: "https://ui.example.test",
            maintenancePageUiUrl: "https://maintenance.example.test",
            badgerMiddlewareName: badger,
            redirectHttpsMiddlewareName: redirectHttps,
            resolveTls: () => tls
        });
        return output;
    }

    function makeRedirects() {
        const redirect: RedirectRouteRow = {
            redirectId: 1,
            name: "old",
            fullDomain: "gateway.example.test",
            hasSubdomain: true,
            attachedTo: "resource",
            resourceId: 1,
            enabled: true,
            wildcard: false,
            ssl: true,
            matchPath: "/old",
            pathMatchType: "exact",
            priority: null
        };
        const output = { http: { routers: {} } };
        buildRedirectConfig({
            config_output: output,
            redirects: [
                redirect,
                {
                    ...redirect,
                    redirectId: 2,
                    attachedTo: "domain",
                    resourceId: null
                }
            ],
            badgerMiddlewareName: badger,
            redirectHttpsMiddlewareName: redirectHttps,
            resolveTls: () => tls,
            mtlsCaCertsByResource
        });
        return output;
    }

    const scenario = () => [
        makeGateway("forced", true),
        makeGateway("automatic", false),
        makeGateway("automatic", true),
        makeRedirects()
    ];

    assert.deepEqual(
        configSchema.shape.traefik.parse(undefined).pre_auth_middlewares,
        []
    );
    assert.throws(() =>
        configSchema.shape.traefik.parse({ pre_auth_middlewares: "first@file" })
    );
    configure();
    const baseline = scenario();
    configure([]);
    assert.deepEqual(scenario(), baseline);

    configure(preAuth);
    const configured = scenario();
    assert.deepEqual(preAuth, ["first@file", "second@kubernetescrd"]);
    for (const [i, output] of configured.entries()) {
        const before = baseline[i].http.routers as Record<
            string,
            { middlewares: string[]; tls?: typeof mtls }
        >;
        const after = output.http.routers as typeof before;
        assert.deepEqual(Object.keys(after), Object.keys(before));
        for (const [name, router] of Object.entries(after)) {
            const original = before[name];
            const chain = original.middlewares;
            const position = chain.indexOf(badger);
            const expected =
                position >= 0
                    ? [
                          ...chain.slice(0, position),
                          ...preAuth,
                          ...chain.slice(position)
                      ]
                    : name.includes("-maintenance-router")
                      ? [...preAuth, ...chain]
                      : [redirectHttps];
            assert.deepEqual(
                router,
                { ...original, middlewares: expected },
                name
            );
            if (router.tls && name !== "2-redirect-old-router") {
                assert.deepEqual(router.tls, mtls, name);
            }
            after[name].middlewares = chain;
        }
        // The option only changes router middleware references.
        assert.deepEqual(output, baseline[i]);
    }

    const [forced, unavailable, healthy] = baseline;
    for (const maintenance of [forced, unavailable]) {
        const routers = maintenance.http.routers as Record<
            string,
            { middlewares: string[]; priority: number }
        >;
        assert.deepEqual(routers["bg-r1-maintenance-router"].middlewares, [
            "bg-r1-maintenance-rewrite",
            "bg-r1-maintenance-headers"
        ]);
        assert.deepEqual(
            routers["bg-r1-maintenance-router-assets"].middlewares,
            ["bg-r1-maintenance-headers"]
        );
        assert.equal(routers["bg-r1-maintenance-router"].priority, 2000);
        assert.equal(routers["bg-r1-maintenance-router-assets"].priority, 2001);
    }
    assert.deepEqual(Object.keys(healthy.http.routers).sort(), [
        "bg-r1-assets-router",
        "bg-r1-redirect",
        "bg-r1-ssh-router",
        "bg-r1-ui-router"
    ]);

    console.log("Pre-authentication middleware tests passed");
} finally {
    hooks.deregister();
}
