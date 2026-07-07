/*
 * This file is part of a proprietary work.
 *
 * Copyright (c) 2025-2026 Fossorial, Inc.
 * All rights reserved.
 *
 * This file is licensed under the Fossorial Commercial License.
 * You may not use this file except in compliance with the License.
 * Unauthorized use, copying, modification, or distribution is strictly prohibited.
 *
 * This file is not licensed under the AGPLv3.
 */

import { build } from "@server/build";
import { db, Org, orgs, ResourceSession, sessions, users } from "@server/db";
import license from "#private/license/license";
import { eq } from "drizzle-orm";
import {
    CheckOrgAccessPolicyProps,
    CheckOrgAccessPolicyResult
} from "@server/lib/checkOrgAccessPolicy";
import { UserType } from "@server/types/UserTypes";

function formatMaxSessionLengthRequirement(
    maxSessionLengthHours: number
): string {
    if (maxSessionLengthHours < 24) {
        return `This organization requires you to log in every ${maxSessionLengthHours} hours.`;
    }

    const maxDays = Math.round(maxSessionLengthHours / 24);
    return `This organization requires you to log in every ${maxDays} days.`;
}

function buildOrgAccessPolicyError(
    policies: CheckOrgAccessPolicyResult["policies"]
): string | undefined {
    if (!policies) {
        return undefined;
    }

    const errors: string[] = [];

    if (policies.requiredTwoFactor === false) {
        errors.push(
            "This organization requires two-factor authentication. Enable two-factor authentication on your account to continue."
        );
    }

    if (policies.maxSessionLength?.compliant === false) {
        errors.push(
            `Your session has expired. ${formatMaxSessionLengthRequirement(
                policies.maxSessionLength.maxSessionLengthHours
            )}`
        );
    }

    if (policies.passwordAge?.compliant === false) {
        errors.push(
            `Your password has expired. This organization requires you to change your password every ${policies.passwordAge.maxPasswordAgeDays} days.`
        );
    }

    return errors.length > 0 ? errors.join(" ") : undefined;
}

export function enforceResourceSessionLength(
    resourceSession: ResourceSession,
    org: Org
): { valid: boolean; error?: string } {
    if (org.maxSessionLengthHours) {
        const sessionIssuedAt = resourceSession.issuedAt; // may be null
        const maxSessionLengthHours = org.maxSessionLengthHours;

        if (sessionIssuedAt) {
            const maxSessionLengthMs = maxSessionLengthHours * 60 * 60 * 1000;
            const sessionAgeMs = Date.now() - sessionIssuedAt;

            if (sessionAgeMs > maxSessionLengthMs) {
                return {
                    valid: false,
                    error: `Your resource session has expired. ${formatMaxSessionLengthRequirement(
                        maxSessionLengthHours
                    )}`
                };
            }
        } else {
            return {
                valid: false,
                error: `Your resource session is invalid. ${formatMaxSessionLengthRequirement(
                    maxSessionLengthHours
                )}`
            };
        }
    }

    return { valid: true };
}

export async function checkOrgAccessPolicy(
    props: CheckOrgAccessPolicyProps
): Promise<CheckOrgAccessPolicyResult> {
    const userId = props.userId || props.user?.userId;
    const orgId = props.orgId || props.org?.orgId;
    const sessionId = props.sessionId || props.session?.sessionId;

    if (!orgId) {
        return {
            allowed: false,
            error: "Unable to verify organization access. Organization information is missing."
        };
    }
    if (!userId) {
        return {
            allowed: false,
            error: "Unable to verify organization access. User information is missing."
        };
    }
    if (!sessionId) {
        return {
            allowed: false,
            error: "Your session is invalid. Please log in again."
        };
    }

    if (build === "enterprise") {
        const isUnlocked = await license.isUnlocked();
        // if not licensed, don't check the policies
        if (!isUnlocked) {
            return { allowed: true };
        }
    }

    // TODO: check that the org is subscribed

    // get the needed data

    if (!props.org) {
        const [orgQuery] = await db
            .select()
            .from(orgs)
            .where(eq(orgs.orgId, orgId));
        props.org = orgQuery;
        if (!props.org) {
            return {
                allowed: false,
                error: "This organization could not be found."
            };
        }
    }

    if (!props.user) {
        const [userQuery] = await db
            .select()
            .from(users)
            .where(eq(users.userId, userId));
        props.user = userQuery;
        if (!props.user) {
            return {
                allowed: false,
                error: "Your account could not be found."
            };
        }
    }

    if (!props.session) {
        const [sessionQuery] = await db
            .select()
            .from(sessions)
            .where(eq(sessions.sessionId, sessionId));
        props.session = sessionQuery;
        if (!props.session) {
            return {
                allowed: false,
                error: "Your session has expired. Please log in again."
            };
        }
    }

    if (props.session.userId !== props.user.userId) {
        return {
            allowed: false,
            error: "Your session is invalid. Please log in again."
        };
    }

    // now check the policies
    const policies: CheckOrgAccessPolicyResult["policies"] = {};

    // only applies to internal users; oidc users 2fa is managed by the IDP
    if (props.user.type === UserType.Internal && props.org.requireTwoFactor) {
        policies.requiredTwoFactor = props.user.twoFactorEnabled || false;
    }

    // applies to all users
    if (props.org.maxSessionLengthHours) {
        const sessionIssuedAt = props.session.issuedAt; // may be null
        const maxSessionLengthHours = props.org.maxSessionLengthHours;

        if (sessionIssuedAt) {
            const maxSessionLengthMs = maxSessionLengthHours * 60 * 60 * 1000;
            const sessionAgeMs = Date.now() - sessionIssuedAt;
            policies.maxSessionLength = {
                compliant: sessionAgeMs <= maxSessionLengthMs,
                maxSessionLengthHours,
                sessionAgeHours: sessionAgeMs / (60 * 60 * 1000)
            };
        } else {
            policies.maxSessionLength = {
                compliant: false,
                maxSessionLengthHours,
                sessionAgeHours: maxSessionLengthHours
            };
        }
    }

    // only applies to internal users; oidc users don't have passwords
    if (props.user.type === UserType.Internal && props.org.passwordExpiryDays) {
        if (props.user.lastPasswordChange) {
            const passwordExpiryDays = props.org.passwordExpiryDays;
            const passwordAgeMs = Date.now() - props.user.lastPasswordChange;
            const passwordAgeDays = passwordAgeMs / (24 * 60 * 60 * 1000);

            policies.passwordAge = {
                compliant: passwordAgeDays <= passwordExpiryDays,
                maxPasswordAgeDays: passwordExpiryDays,
                passwordAgeDays: passwordAgeDays
            };
        } else {
            policies.passwordAge = {
                compliant: false,
                maxPasswordAgeDays: props.org.passwordExpiryDays,
                passwordAgeDays: props.org.passwordExpiryDays // Treat as expired
            };
        }
    }

    let allowed = true;
    if (policies.requiredTwoFactor === false) {
        allowed = false;
    }
    if (
        policies.maxSessionLength &&
        policies.maxSessionLength.compliant === false
    ) {
        allowed = false;
    }
    if (policies.passwordAge && policies.passwordAge.compliant === false) {
        allowed = false;
    }

    const policyError = buildOrgAccessPolicyError(policies);

    return {
        allowed,
        policies,
        error: allowed
            ? undefined
            : (policyError ??
              "You do not meet this organization's security requirements.")
    };
}
