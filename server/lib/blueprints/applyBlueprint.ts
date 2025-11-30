import { db, newts, blueprints, Blueprint } from "@server/db";
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
        });

        logger.debug(
            `Successfully updated proxy resources for org ${orgId}: ${JSON.stringify(proxyResourcesResults)}`
        );

        // We need to update the targets on the newts from the successfully updated information
        for (const result of proxyResourcesResults) {
            for (const target of result.targetsToUpdate) {
                const [site] = await db
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
            const [site] = await db
                .select()
                .from(sites)
                .innerJoin(newts, eq(sites.siteId, newts.siteId))
                .where(
                    and(
                        eq(sites.siteId, result.resource.siteId),
                        eq(sites.orgId, orgId),
                        eq(sites.type, "newt"),
                        isNotNull(sites.pubKey)
                    )
                )
                .limit(1);

            if (site) {
                logger.debug(
                    `Updating client resource ${result.resource.siteResourceId} on site ${site.sites.siteId}`
                );

                await addClientTargets(
                    site.newt.newtId,
                    result.resource.destinationIp,
                    result.resource.destinationPort,
                    result.resource.protocol,
                    result.resource.proxyPort
                );
            }
        }

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

// await updateDatabaseFromConfig("org_i21aifypnlyxur2", {
//     resources: {
//         "resource-nice-id": {
//             name: "this is my resource",
//             protocol: "http",
//             "full-domain": "level1.test.example.com",
//             "host-header": "example.com",
//             "tls-server-name": "example.com",
//             auth: {
//                 pincode: 123456,
//                 password: "sadfasdfadsf",
//                 "sso-enabled": true,
//                 "sso-roles": ["Member"],
//                 "sso-users": ["owen@pangolin.net"],
//                 "whitelist-users": ["owen@pangolin.net"]
//             },
//             targets: [
//                 {
//                     site: "glossy-plains-viscacha-rat",
//                     hostname: "localhost",
//                     method: "http",
//                     port: 8000,
//                     healthcheck: {
//                         port: 8000,
//                         hostname: "localhost"
//                     }
//                 },
//                 {
//                     site: "glossy-plains-viscacha-rat",
//                     hostname: "localhost",
//                     method: "http",
//                     port: 8001
//                 }
//             ]
//         },
// "resource-nice-id2": {
//     name: "http server",
//     protocol: "tcp",
//     "proxy-port": 3000,
//     targets: [
//         {
//             site: "glossy-plains-viscacha-rat",
//             hostname: "localhost",
//             port: 3000,
//         }
//     ]
// }
//     }
// });
