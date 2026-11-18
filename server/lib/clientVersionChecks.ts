import semver from "semver";

// NEWT AND OLM
// Pass the newt/olm library version (newts.version / olms.version), not
// agentVersion: the agent may be an app embedding the library (the CLI,
// Pangolin Windows, ...) whose version is unrelated to the protocol support.
export function canCompress(
    clientVersion: string | null | undefined,
    agent: "newt" | "olm"
): boolean {
    try {
        if (!clientVersion) return false;
        // check if it is a valid semver
        if (!semver.valid(clientVersion)) return false;
        if (agent === "newt") {
            return semver.gte(clientVersion, "1.10.3");
        } else if (agent === "olm") {
            return semver.gte(clientVersion, "1.4.3");
        }
        return false;
    } catch {
        return false;
    }
}

// Whether this newt client understands `tlsCertId` references into the
// sync message's `certs` array, instead of requiring each target to carry
// its own inline `tlsCert`/`tlsKey` PEM data. Bump the version floor here to
// match whatever release first ships the newt-side support.
// NEWT
export function supportsCertReferences(
    clientVersion: string | null | undefined
): boolean {
    try {
        if (!clientVersion) return false;
        if (!semver.valid(clientVersion)) return false;
        return semver.gte(clientVersion, "1.16.0");
    } catch {
        return false;
    }
}

// Whether this newt client understands newt/wg/client-identities/add, used to
// set Remote-* headers on requests through its HTTP proxy. Bump the version
// floor here to match whatever release first ships the newt-side support.
// NEWT
export function supportsClientIdentities(
    clientVersion: string | null | undefined
): boolean {
    try {
        if (!clientVersion) return false;
        if (!semver.valid(clientVersion)) return false;
        return semver.gte(clientVersion, "1.19.0");
    } catch {
        return false;
    }
}

// Whether this newt client understands the v2 subnet proxy target format.
// Older clients need targets converted back to v1 before they are sent.
// NEWT
export function supportsTargetsV2(
    clientVersion: string | null | undefined
): boolean {
    try {
        if (!clientVersion) return false;
        if (!semver.valid(clientVersion)) return false;
        return semver.gte(clientVersion, "1.10.3");
    } catch {
        return false;
    }
}

// Whether this newt client understands the sync message sent when its config
// version falls behind the server's.
// NEWT
export function supportsSync(
    clientVersion: string | null | undefined
): boolean {
    try {
        if (!clientVersion) return false;
        if (!semver.valid(clientVersion)) return false;
        return semver.gte(clientVersion, "1.14.0");
    } catch {
        return false;
    }
}
