/**
 * Pure membership logic of an auto-provisioned login, shared by the real login
 * and the test login. No DB access, so it can be unit tested.
 */

export type CurrentMembership = {
    orgId: string;
    /** `null` (legacy rows) counts as neither manual nor auto-managed, as before. */
    autoManaged: boolean | null;
    roleIds?: number[];
};

export type DesiredMembership = {
    orgId: string;
    roleIds: number[];
    /** Roles created in the org when the membership is applied ("create missing roles"). */
    missingRoleNames: string[];
};

/**
 * Whether the login is refused because no policy matched. An existing user still
 * gets in with a manual membership, or an auto-managed one in an org that isn't a
 * candidate (e.g. created by directory sync in an org with auto-provision off).
 *
 * `currentMemberships` is `null` when the user doesn't exist yet.
 */
export function isLoginDenied({
    currentMemberships,
    desired,
    candidateOrgIds
}: {
    currentMemberships: CurrentMembership[] | null;
    desired: DesiredMembership[];
    candidateOrgIds: Set<string>;
}): boolean {
    if (desired.length > 0) {
        return false;
    }
    if (currentMemberships === null) {
        return true;
    }
    const hasManualMembership = currentMemberships.some(
        (m) => m.autoManaged === false
    );
    const keepsOtherMemberships = currentMemberships.some(
        (m) => m.autoManaged === true && !candidateOrgIds.has(m.orgId)
    );
    return !hasManualMembership && !keepsOtherMemberships;
}

export type MembershipChanges = {
    /** Orgs the user joins, as an auto-managed member. */
    add: DesiredMembership[];
    /** Auto-managed memberships in candidate orgs that no longer match. */
    remove: string[];
    /** Auto-managed memberships whose roles are replaced by the mapped roles. */
    updateRoles: (DesiredMembership & { previousRoleIds?: number[] })[];
    /** Orgs that matched but where the user is a manual member: left untouched. */
    keptManual: string[];
};

/**
 * What applying the desired memberships changes. Only auto-managed memberships
 * in candidate orgs are touched: manual ones, and orgs with auto-provision off,
 * are kept as they are.
 */
export function planMembershipChanges({
    currentMemberships,
    desired,
    candidateOrgIds
}: {
    currentMemberships: CurrentMembership[];
    desired: DesiredMembership[];
    candidateOrgIds: Set<string>;
}): MembershipChanges {
    const desiredByOrgId = new Map(desired.map((d) => [d.orgId, d]));
    const autoManaged = currentMemberships.filter(
        (m) => m.autoManaged === true
    );

    return {
        add: desired.filter(
            (d) => !currentMemberships.some((m) => m.orgId === d.orgId)
        ),
        remove: autoManaged
            .filter(
                (m) =>
                    candidateOrgIds.has(m.orgId) && !desiredByOrgId.has(m.orgId)
            )
            .map((m) => m.orgId),
        updateRoles: autoManaged.flatMap((m) => {
            const d = desiredByOrgId.get(m.orgId);
            return d ? [{ ...d, previousRoleIds: m.roleIds }] : [];
        }),
        keptManual: currentMemberships
            .filter(
                (m) => m.autoManaged !== true && desiredByOrgId.has(m.orgId)
            )
            .map((m) => m.orgId)
    };
}
