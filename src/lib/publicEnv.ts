import { Env } from "./types/env";

/**
 * Deployment details from `pullEnv()` that no client needs before it is
 * authenticated: the exact server version, the internal listener ports,
 * and the filesystem paths of the GeoIP databases.
 *
 * Every client-side consumer of these fields renders inside the
 * authenticated dashboard shell: the sidebar version badge and its
 * release link, the product-updates check, the maxmind gates in the
 * policy forms, and the api client's direct-port fallback. Pages served
 * to unauthenticated visitors (login, signup, resource auth) never
 * render any of them, so those requests only ever need this sanitized
 * shape.
 *
 * Fields are emptied rather than omitted so the `Env` type stays intact
 * and every existing consumer degrades gracefully: a blank `nextPort`
 * makes the api client's port comparison fall through to the public
 * `dashboardUrl` base, and the maxmind gates keep their `length > 0`
 * behavior for the authenticated requests that can reach them.
 */
export function sanitizeEnvForAnonymousClient(env: Env): Env {
    return {
        ...env,
        server: {
            ...env.server,
            nextPort: "",
            externalPort: "",
            maxmind_db_path: "",
            maxmind_asn_path: ""
        },
        app: {
            ...env.app,
            version: ""
        }
    };
}
