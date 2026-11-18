import type { LicenseStatus } from "@server/license/license";

export type LicenseLimitKind = "sites" | "users" | "machines";

export type LicenseLimitViolation = {
    kind: LicenseLimitKind;
    used: number;
    max: number;
};

/**
 * Returns the limits the host is currently over.
 *
 * The server sets `isLicenseValid` to false when usage exceeds a limit, even
 * if the key itself is valid. Limits are only summed from valid keys, so a
 * defined max that is exceeded means a valid key exists and the host is
 * invalid only because of usage.
 */
export function getLicenseLimitViolations(
    status: LicenseStatus | null | undefined
): LicenseLimitViolation[] {
    if (!status) {
        return [];
    }

    const checks: [LicenseLimitKind, number | undefined, number | undefined][] =
        [
            ["sites", status.usedSites, status.maxSites],
            ["users", status.usedUsers, status.maxUsers],
            ["machines", status.usedMachines, status.maxMachines]
        ];

    const violations: LicenseLimitViolation[] = [];
    for (const [kind, used, max] of checks) {
        if (max !== undefined && max !== null && (used ?? 0) > max) {
            violations.push({ kind, used: used ?? 0, max });
        }
    }
    return violations;
}

const violationMessageKeys: Record<LicenseLimitKind, string> = {
    sites: "licenseLimitSitesExceeded",
    users: "licenseLimitUsersExceeded",
    machines: "licenseLimitMachinesExceeded"
};

export function formatLicenseLimitViolations(
    violations: LicenseLimitViolation[],
    t: (key: string, values?: Record<string, string | number>) => string
): string {
    return violations
        .map((v) =>
            t(violationMessageKeys[v.kind], { used: v.used, max: v.max })
        )
        .join(", ");
}
