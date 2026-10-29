import { Env } from "./types/env";

/**
 * Deployment details from `pullEnv()` that only an authenticated render
 * needs: the exact server version, the internal listener ports, and the
 * filesystem paths of the GeoIP databases.
 *
 * The root layout applies this to the env it hands to EnvProvider on
 * every request. The full env is re-provisioned inside the dashboard
 * shell (`Layout`), whose every calling layout validates the session
 * server-side before rendering it, so the fields below reach the
 * browser only in the payload of an authenticated render, never in
 * the payload of the login, signup, or resource-auth pages, whatever
 * cookie headers the request carries.
 *
 * The listener ports are decided per request origin: a request that
 * already talks to the Next server directly (the Host header's port is
 * the `nextPort`) knows that port by construction and needs the
 * `externalPort` to reach the API in that access mode, so both ports
 * are kept for it. For every other origin (anything proxied) the
 * ports are internal deployment details and are emptied.
 *
 * Fields are emptied rather than omitted so the `Env` type stays intact
 * and every existing consumer degrades gracefully: an empty `nextPort`
 * never matches in `resolveClientApiBaseUrl`, so the api client falls
 * back to the public `dashboardUrl` base, and the maxmind gates keep
 * their `length > 0` shape.
 */
export function sanitizeEnvForClientPayload(
    env: Env,
    requestHost: string | null
): Env {
    const requestPort = (requestHost ?? "").split(":").pop() ?? "";
    const directNextAccess =
        requestPort !== "" && requestPort === env.server.nextPort;

    return {
        ...env,
        server: {
            ...env.server,
            nextPort: directNextAccess ? env.server.nextPort : "",
            externalPort: directNextAccess ? env.server.externalPort : "",
            maxmind_db_path: "",
            maxmind_asn_path: ""
        },
        app: {
            ...env.app,
            version: ""
        }
    };
}

/**
 * Resolve the base URL the browser api client should use.
 *
 * `window.location.port === env.server.nextPort` means the user is
 * addressing the Next server directly, so the API is reached on the
 * external port of the same host. An empty `nextPort` (the sanitized
 * env of a proxied request) never matches, including on default
 * ports where `window.location.port` is also empty, so those clients
 * always fall through to the public `dashboardUrl` instead of the
 * direct-port branch building `https://<current host>:/api/v1`.
 */
export function resolveClientApiBaseUrl({
    env,
    windowLocation
}: {
    env: Pick<Env, "server" | "app">;
    windowLocation: { port: string; protocol: string; hostname: string };
}): { baseURL: string; directAccess: boolean } {
    const suffix = "api/v1";

    if (
        env.server.nextPort !== "" &&
        windowLocation.port === env.server.nextPort
    ) {
        return {
            baseURL: `${windowLocation.protocol}//${windowLocation.hostname}:${env.server.externalPort}/${suffix}`,
            directAccess: true
        };
    }

    return {
        baseURL: `${env.app.dashboardUrl}/${suffix}`,
        directAccess: false
    };
}
