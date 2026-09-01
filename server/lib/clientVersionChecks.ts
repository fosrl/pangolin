import semver from "semver";

export function canCompress(
    clientVersion: string | null | undefined,
    type: "newt" | "olm"
): boolean {
    try {
        if (!clientVersion) return false;
        // check if it is a valid semver
        if (!semver.valid(clientVersion)) return false;
        if (type === "newt") {
            return semver.gte(clientVersion, "1.10.3");
        } else if (type === "olm") {
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
