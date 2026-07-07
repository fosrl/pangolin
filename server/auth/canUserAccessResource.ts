import { db } from "@server/db";
import { and, eq, inArray, isNull, or } from "drizzle-orm";
import {
    rolePolicies,
    roleResources,
    resources,
    userPolicies,
    userResources
} from "@server/db";

export async function canUserAccessResource({
    userId,
    resourceId,
    roleIds
}: {
    userId: string;
    resourceId: number;
    roleIds: number[];
}): Promise<boolean> {
    const [
        roleResourceAccess,
        rolePolicyAccess,
        userResourceAccess,
        userPolicyAccess
    ] = await Promise.all([
        roleIds.length > 0
            ? db
                  .select()
                  .from(roleResources)
                  .where(
                      and(
                          eq(roleResources.resourceId, resourceId),
                          inArray(roleResources.roleId, roleIds)
                      )
                  )
                  .limit(1)
            : [],
        roleIds.length > 0
            ? db
                  .select({
                      roleId: rolePolicies.roleId,
                      resourcePolicyId: rolePolicies.resourcePolicyId
                  })
                  .from(rolePolicies)
                  .innerJoin(
                      resources,
                      // Shared policy wins; only use default policy when no shared
                      // policy is assigned to the resource.
                      or(
                          eq(
                              resources.resourcePolicyId,
                              rolePolicies.resourcePolicyId
                          ),
                          and(
                              isNull(resources.resourcePolicyId),
                              eq(
                                  resources.defaultResourcePolicyId,
                                  rolePolicies.resourcePolicyId
                              )
                          )
                      )
                  )
                  .where(
                      and(
                          eq(resources.resourceId, resourceId),
                          inArray(rolePolicies.roleId, roleIds)
                      )
                  )
                  .limit(1)
            : [],
        db
            .select()
            .from(userResources)
            .where(
                and(
                    eq(userResources.userId, userId),
                    eq(userResources.resourceId, resourceId)
                )
            )
            .limit(1),
        db
            .select({
                userId: userPolicies.userId,
                resourcePolicyId: userPolicies.resourcePolicyId
            })
            .from(userPolicies)
            .innerJoin(
                resources,
                // Shared policy wins; only use default policy when no shared
                // policy is assigned to the resource.
                or(
                    eq(
                        resources.resourcePolicyId,
                        userPolicies.resourcePolicyId
                    ),
                    and(
                        isNull(resources.resourcePolicyId),
                        eq(
                            resources.defaultResourcePolicyId,
                            userPolicies.resourcePolicyId
                        )
                    )
                )
            )
            .where(
                and(
                    eq(resources.resourceId, resourceId),
                    eq(userPolicies.userId, userId)
                )
            )
            .limit(1)
    ]);

    return (
        roleResourceAccess.length > 0 ||
        rolePolicyAccess.length > 0 ||
        userResourceAccess.length > 0 ||
        userPolicyAccess.length > 0
    );
}
