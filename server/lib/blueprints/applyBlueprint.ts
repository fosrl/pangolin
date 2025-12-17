import { db, newts, blueprints, Blueprint, Site, siteResources, roleSiteResources, userSiteResources, clientSiteResources } from "@server/db";
import { Config, ConfigSchema } from "./types";
import { ProxyResourcesResults, updateProxyResources } from "./proxyResources";
import { fromError } from "zod-validation-error";
import logger from "@server/logger";
import { sites } from "@server/db";
import { eq, and, isNotNull } from "drizzle-orm";
import { addTargets as addProxyTargets } from "@server/routers/newt/targets";
import { addTargets as addClientTargets } from "@server/routers/client/targets";
import {
    ClientResourcesResults,
    updateClientResources
} from "./clientResources";
import { BlueprintSource } from "@server/routers/blueprints/types";
import { stringify as stringifyYaml } from "yaml";
import { faker } from "@faker-js/faker";
import { handleMessagingForUpdatedSiteResource } from "@server/routers/siteResource";
import { rebuildClientAssociationsFromSiteResource } from "../rebuildClientAssociations";

type ApplyBlueprintArgs = {
    orgId: string;
    configData: unknown;
    name?: string;
    siteId?: number;
    source?: BlueprintSource;
};

export async function applyBlueprint({
    orgId,
    configData,
    siteId,
    name,
    source = "API"
}: ApplyBlueprintArgs): Promise<Blueprint> {
    // Validate the input data
    const validationResult = ConfigSchema.safeParse(configData);
    if (!validationResult.success) {
        throw new Error(fromError(validationResult.error).toString());
    }

    const config: Config = validationResult.data;
    let blueprintSucceeded: boolean = false;
    let blueprintMessage: string;
    let error: any | null = null;

    try {
        let proxyResourcesResults: ProxyResourcesResults = [];
        let clientResourcesResults: ClientResourcesResults = [];
        await db.transaction(async (trx) => {
            proxyResourcesResults = await updateProxyResources(
                orgId,
                config,
                trx,
                siteId
            );
            clientResourcesResults = await updateClientResources(
                orgId,
                config,
                trx,
                siteId
            );

            logger.debug(
                `Successfully updated proxy resources for org ${orgId}: ${JSON.stringify(proxyResourcesResults)}`
            );

            // We need to update the targets on the newts from the successfully updated information
            for (const result of proxyResourcesResults) {
                for (const target of result.targetsToUpdate) {
                    const [site] = await trx
                        .select()
                        .from(sites)
                        .innerJoin(newts, eq(sites.siteId, newts.siteId))
                        .where(
                            and(
                                eq(sites.siteId, target.siteId),
                                eq(sites.orgId, orgId),
                                eq(sites.type, "newt"),
                                isNotNull(sites.pubKey)
                            )
                        )
                        .limit(1);

                    if (site) {
                        logger.debug(
                            `Updating target ${target.targetId} on site ${site.sites.siteId}`
                        );

                        // see if you can find a matching target health check from the healthchecksToUpdate array
                        const matchingHealthcheck =
                            result.healthchecksToUpdate.find(
                                (hc) => hc.targetId === target.targetId
                            );

                        await addProxyTargets(
                            site.newt.newtId,
                            [target],
                            matchingHealthcheck ? [matchingHealthcheck] : [],
                            result.proxyResource.protocol,
                            result.proxyResource.proxyPort
                        );
                    }
                }
            }

            logger.debug(
                `Successfully updated client resources for org ${orgId}: ${JSON.stringify(clientResourcesResults)}`
            );

            // We need to update the targets on the newts from the successfully updated information
            for (const result of clientResourcesResults) {
                if (
                    result.oldSiteResource &&
                    result.oldSiteResource.siteId !=
                        result.newSiteResource.siteId
                ) {
                    // query existing associations
                    const existingRoleIds = await trx
                        .select()
                        .from(roleSiteResources)
                        .where(
                            eq(
                                roleSiteResources.siteResourceId,
                                result.oldSiteResource.siteResourceId
                            )
                        )
                        .then((rows) => rows.map((row) => row.roleId));

                    const existingUserIds= await trx
                        .select()
                        .from(userSiteResources)
                        .where(
                            eq(
                                userSiteResources.siteResourceId,
                                result.oldSiteResource.siteResourceId
                            )
                        ).then((rows) => rows.map((row) => row.userId));

                    const existingClientIds = await trx
                        .select()
                        .from(clientSiteResources)
                        .where(
                            eq(
                                clientSiteResources.siteResourceId,
                                result.oldSiteResource.siteResourceId
                            )
                        ).then((rows) => rows.map((row) => row.clientId));

                    // delete the existing site resource
                    await trx
                        .delete(siteResources)
                        .where(
                            and(eq(siteResources.siteResourceId, result.oldSiteResource.siteResourceId))
                        );

                    await rebuildClientAssociationsFromSiteResource(
                        result.oldSiteResource,
                        trx
                    );

                    const [insertedSiteResource] = await trx
                        .insert(siteResources)
                        .values({
                            ...result.oldSiteResource,
                        })
                        .returning();

                    // wait some time to allow for messages to be handled
                    await new Promise((resolve) => setTimeout(resolve, 750));

                    //////////////////// update the associations ////////////////////

                    if (existingRoleIds.length > 0) {
                        await trx.insert(roleSiteResources).values(
                           existingRoleIds.map((roleId) => ({
                                roleId,
                                siteResourceId: insertedSiteResource!.siteResourceId
                            }))
                        );
                    }

                    if (existingUserIds.length > 0) {
                        await trx.insert(userSiteResources).values(
                           existingUserIds.map((userId) => ({
                                userId,
                                siteResourceId: insertedSiteResource!.siteResourceId
                            }))
                        );
                    }

                    if (existingClientIds.length > 0) {
                        await trx.insert(clientSiteResources).values(
                            existingClientIds.map((clientId) => ({
                                clientId,
                                siteResourceId: insertedSiteResource!.siteResourceId
                            }))
                        );
                    }

                    await rebuildClientAssociationsFromSiteResource(
                        insertedSiteResource,
                        trx
                    );

                } else {
                    const [newSite] = await trx
                        .select()
                        .from(sites)
                        .innerJoin(newts, eq(sites.siteId, newts.siteId))
                        .where(
                            and(
                                eq(sites.siteId, result.newSiteResource.siteId),
                                eq(sites.orgId, orgId),
                                eq(sites.type, "newt"),
                                isNotNull(sites.pubKey)
                            )
                        )
                        .limit(1);

                    if (!newSite) {
                        logger.debug(
                            `No newt site found for client resource ${result.newSiteResource.siteResourceId}, skipping target update`
                        );
                        continue;
                    }

                    logger.debug(
                        `Updating client resource ${result.newSiteResource.siteResourceId} on site ${newSite.sites.siteId}`
                    );

                    await handleMessagingForUpdatedSiteResource(
                        result.oldSiteResource,
                        result.newSiteResource,
                        {
                            siteId: newSite.sites.siteId,
                            orgId: newSite.sites.orgId
                        },
                        trx
                    );
                }

                // await addClientTargets(
                //     site.newt.newtId,
                //     result.resource.destination,
                //     result.resource.destinationPort,
                //     result.resource.protocol,
                //     result.resource.proxyPort
                // );
            }
        });

        blueprintSucceeded = true;
        blueprintMessage = "Blueprint applied successfully";
    } catch (err) {
        blueprintSucceeded = false;
        blueprintMessage = `Blueprint applied with errors: ${err}`;
        logger.error(blueprintMessage);
        error = err;
    }

    let blueprint: Blueprint | null = null;
    await db.transaction(async (trx) => {
        const newBlueprint = await trx
            .insert(blueprints)
            .values({
                orgId,
                name:
                    name ??
                    `${faker.word.adjective()} ${faker.word.adjective()} ${faker.word.noun()}`,
                contents: stringifyYaml(configData),
                createdAt: Math.floor(Date.now() / 1000),
                succeeded: blueprintSucceeded,
                message: blueprintMessage,
                source
            })
            .returning();

        blueprint = newBlueprint[0];
    });

    if (!blueprint || (source !== "UI" && !blueprintSucceeded)) {
        //             ^^^^^^^^^^^^^^^ The UI considers a failed blueprint as a valid response
        throw error ?? "Unknown Server Error";
    }

    return blueprint;
}
