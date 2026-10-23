import {
    db,
    Org,
    orgs,
    resourceAccessToken,
    resources,
    siteResources,
    sites,
    Transaction,
    userOrgRoles,
    userOrgs,
    userResources,
    userSiteResources,
    userSites
} from "@server/db";
import { eq, and, inArray, ne, exists } from "drizzle-orm";
import { usageService } from "@server/lib/billing/usageService";
import { LimitId } from "@server/lib/billing";

export async function assignUserToOrg(
    org: Org,
    values: typeof userOrgs.$inferInsert,
    roleIds: number[],
    trx: Transaction | typeof db = db
) {
    const uniqueRoleIds = [...new Set(roleIds)];
    if (uniqueRoleIds.length === 0) {
        throw new Error("assignUserToOrg requires at least one roleId");
    }

    // A user can only be a member of an org once. Adding a second membership
    // for the same org makes the user show up twice in the member list and
    // blocks removing them from the org.
    const [existingUserOrg] = await trx
        .select()
        .from(userOrgs)
        .where(
            and(
                eq(userOrgs.userId, values.userId),
                eq(userOrgs.orgId, values.orgId)
            )
        )
        .limit(1);

    let userOrg = existingUserOrg;
    const isNewMembership = !userOrg;

    if (!userOrg) {
        [userOrg] = await trx.insert(userOrgs).values(values).returning();
    } else if (values.isOwner && !userOrg.isOwner) {
        const [updatedUserOrg] = await trx
            .update(userOrgs)
            .set({ isOwner: true })
            .where(eq(userOrgs.userId, userOrg.userId))
            .returning();
        userOrg = updatedUserOrg;
    }

    // only add the roles the user does not have in this org yet
    const existingRoleRows = await trx
        .select({ roleId: userOrgRoles.roleId })
        .from(userOrgRoles)
        .where(
            and(
                eq(userOrgRoles.userId, userOrg.userId),
                eq(userOrgRoles.orgId, userOrg.orgId)
            )
        );
    const existingRoleIds = new Set(
        existingRoleRows.map((role) => role.roleId)
    );
    const rolesToAdd = uniqueRoleIds.filter(
        (roleId) => !existingRoleIds.has(roleId)
    );

    if (rolesToAdd.length > 0) {
        await trx.insert(userOrgRoles).values(
            rolesToAdd.map((roleId) => ({
                userId: userOrg.userId,
                orgId: userOrg.orgId,
                roleId
            }))
        );
    }

    // the user was already a member of this org, so nothing was added
    if (!isNewMembership) {
        return;
    }

    // calculate if the user is in any other of the orgs before we count it as an add to the billing org
    if (org.billingOrgId) {
        const otherBillingOrgs = await trx
            .select()
            .from(orgs)
            .where(
                and(
                    eq(orgs.billingOrgId, org.billingOrgId),
                    ne(orgs.orgId, org.orgId)
                )
            );

        const billingOrgIds = otherBillingOrgs.map((o) => o.orgId);

        const orgsInBillingDomainThatTheUserIsStillIn = await trx
            .select()
            .from(userOrgs)
            .where(
                and(
                    eq(userOrgs.userId, userOrg.userId),
                    inArray(userOrgs.orgId, billingOrgIds)
                )
            );

        if (orgsInBillingDomainThatTheUserIsStillIn.length === 0) {
            await usageService.add(org.orgId, LimitId.USERS, 1, trx);
        }
    }
}

export async function removeUserFromOrg(
    org: Org,
    userId: string,
    trx: Transaction | typeof db = db
) {
    await trx
        .delete(userOrgRoles)
        .where(
            and(
                eq(userOrgRoles.userId, userId),
                eq(userOrgRoles.orgId, org.orgId)
            )
        );
    await trx
        .delete(userOrgs)
        .where(and(eq(userOrgs.userId, userId), eq(userOrgs.orgId, org.orgId)));

    await trx
        .delete(resourceAccessToken)
        .where(
            and(
                eq(resourceAccessToken.userId, userId),
                eq(resourceAccessToken.orgId, org.orgId)
            )
        );

    await trx.delete(userResources).where(
        and(
            eq(userResources.userId, userId),
            exists(
                trx
                    .select()
                    .from(resources)
                    .where(
                        and(
                            eq(resources.resourceId, userResources.resourceId),
                            eq(resources.orgId, org.orgId)
                        )
                    )
            )
        )
    );

    await trx.delete(userSiteResources).where(
        and(
            eq(userSiteResources.userId, userId),
            exists(
                trx
                    .select()
                    .from(siteResources)
                    .where(
                        and(
                            eq(
                                siteResources.siteResourceId,
                                userSiteResources.siteResourceId
                            ),
                            eq(siteResources.orgId, org.orgId)
                        )
                    )
            )
        )
    );

    await trx.delete(userSites).where(
        and(
            eq(userSites.userId, userId),
            exists(
                db
                    .select()
                    .from(sites)
                    .where(
                        and(
                            eq(sites.siteId, userSites.siteId),
                            eq(sites.orgId, org.orgId)
                        )
                    )
            )
        )
    );

    // calculate if the user is in any other of the orgs before we count it as an remove to the billing org
    if (org.billingOrgId) {
        const billingOrgs = await trx
            .select()
            .from(orgs)
            .where(eq(orgs.billingOrgId, org.billingOrgId));

        const billingOrgIds = billingOrgs.map((o) => o.orgId);

        const orgsInBillingDomainThatTheUserIsStillIn = await trx
            .select()
            .from(userOrgs)
            .where(
                and(
                    eq(userOrgs.userId, userId),
                    inArray(userOrgs.orgId, billingOrgIds)
                )
            );

        if (orgsInBillingDomainThatTheUserIsStillIn.length === 0) {
            await usageService.add(org.orgId, LimitId.USERS, -1, trx);
        }
    }
}
