import { eq, inArray } from "drizzle-orm";
import {
    db,
    newts,
    resourcePolicies,
    resources,
    sites,
    targetHealthCheck,
    targets,
    type Resource,
    type Target,
    type TargetHealthCheck,
    type Transaction
} from "@server/db";
import logger from "@server/logger";
import { removeTargets } from "@server/routers/newt/targets";
import createHttpError from "http-errors";
import HttpCode from "@server/types/HttpCode";

export type DeleteResourceResult = {
    deletedResource: Resource;
    targetsToBeRemoved: Target[];
    healthChecksToBeRemoved: TargetHealthCheck[];
};

export async function performDeleteResources(
    resourceIds: number[],
    trx: Transaction | typeof db = db
): Promise<DeleteResourceResult[]> {
    if (resourceIds.length === 0) {
        return [];
    }

    const targetsToBeRemoved = await trx
        .select()
        .from(targets)
        .where(inArray(targets.resourceId, resourceIds));

    const targetIds = targetsToBeRemoved.map((t) => t.targetId);
    const healthChecksToBeRemoved =
        targetIds.length > 0
            ? await trx
                  .select()
                  .from(targetHealthCheck)
                  .where(inArray(targetHealthCheck.targetId, targetIds))
            : [];

    const deletedResources = await trx
        .delete(resources)
        .where(inArray(resources.resourceId, resourceIds))
        .returning();

    const policyIds = deletedResources
        .map((resource) => resource.defaultResourcePolicyId)
        .filter((id): id is number => id != null);

    if (policyIds.length > 0) {
        await trx
            .delete(resourcePolicies)
            .where(inArray(resourcePolicies.resourcePolicyId, policyIds));
    }

    if (deletedResources.length > 0) {
        logger.debug(`Deleted ${deletedResources.length} resources`);
    }

    const targetsByResourceId = new Map<number, Target[]>();
    for (const target of targetsToBeRemoved) {
        const existing = targetsByResourceId.get(target.resourceId) ?? [];
        existing.push(target);
        targetsByResourceId.set(target.resourceId, existing);
    }

    const targetIdToResourceId = new Map(
        targetsToBeRemoved.map((target) => [target.targetId, target.resourceId])
    );

    const healthChecksByResourceId = new Map<number, TargetHealthCheck[]>();
    for (const healthCheck of healthChecksToBeRemoved) {
        const resourceId = targetIdToResourceId.get(healthCheck.targetId!);
        if (resourceId == null) {
            continue;
        }
        const existing = healthChecksByResourceId.get(resourceId) ?? [];
        existing.push(healthCheck);
        healthChecksByResourceId.set(resourceId, existing);
    }

    return deletedResources.map((deletedResource) => ({
        deletedResource,
        targetsToBeRemoved:
            targetsByResourceId.get(deletedResource.resourceId) ?? [],
        healthChecksToBeRemoved:
            healthChecksByResourceId.get(deletedResource.resourceId) ?? []
    }));
}

export async function performDeleteResource(
    resourceId: number,
    trx: Transaction | typeof db = db
): Promise<DeleteResourceResult | null> {
    const [result] = await performDeleteResources([resourceId], trx);
    return result ?? null;
}

export async function runResourceDeleteSideEffects(
    result: DeleteResourceResult
): Promise<void> {
    const { deletedResource, targetsToBeRemoved, healthChecksToBeRemoved } =
        result;

    for (const target of targetsToBeRemoved) {
        const [site] = await db
            .select()
            .from(sites)
            .where(eq(sites.siteId, target.siteId))
            .limit(1);

        if (!site) {
            throw createHttpError(
                HttpCode.NOT_FOUND,
                `Site with ID ${target.siteId} not found`
            );
        }

        if (site.pubKey && site.type === "newt") {
            const [newt] = await db
                .select()
                .from(newts)
                .where(eq(newts.siteId, site.siteId))
                .limit(1);

            if (newt) {
                await removeTargets(
                    newt.newtId,
                    [],
                    healthChecksToBeRemoved,
                    deletedResource.mode === "udp" ? "udp" : "tcp",
                    newt.version
                );
            }
        }
    }
}
