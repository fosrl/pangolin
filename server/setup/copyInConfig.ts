import { db, dnsRecords } from "@server/db";
import { domains, exitNodes, orgDomains, orgs, resources } from "@server/db";
import config from "@server/lib/config";
import { eq, ne } from "drizzle-orm";
import logger from "@server/logger";

export async function copyInConfig() {
    const endpoint = config.getRawConfig().gerbil.base_endpoint;
    const listenPort = config.getRawConfig().gerbil.start_port;

    if (
        !config.getRawConfig().flags?.disable_config_managed_domains &&
        config.getRawConfig().domains
    ) {
        await copyInDomains();
    }

    const exitNodeName = config.getRawConfig().gerbil.exit_node_name;
    if (exitNodeName) {
        await db
            .update(exitNodes)
            .set({ endpoint, listenPort })
            .where(eq(exitNodes.name, exitNodeName));
    } else {
        await db
            .update(exitNodes)
            .set({ endpoint })
            .where(ne(exitNodes.endpoint, endpoint));
        await db
            .update(exitNodes)
            .set({ listenPort })
            .where(ne(exitNodes.listenPort, listenPort));
    }
}

async function copyInDomains() {
    await db.transaction(async (trx) => {
        const rawDomains = config.getRawConfig().domains!; // always defined if disable flag is not set

        const configDomains = Object.entries(rawDomains).map(
            ([key, value]) => ({
                domainId: key,
                baseDomain: value.base_domain.toLowerCase(),
                certResolver: value.cert_resolver || null,
                preferWildcardCert: value.prefer_wildcard_cert || null
            })
        );

        const existingDomains = await trx
            .select()
            .from(domains)
            .where(eq(domains.configManaged, true));
        const existingDomainKeys = new Set(
            existingDomains.map((d) => d.domainId)
        );

        const configDomainKeys = new Set(configDomains.map((d) => d.domainId));
        for (const existingDomain of existingDomains) {
            if (!configDomainKeys.has(existingDomain.domainId)) {
                await trx
                    .delete(domains)
                    .where(eq(domains.domainId, existingDomain.domainId));
                await trx
                    .delete(dnsRecords)
                    .where(eq(dnsRecords.domainId, existingDomain.domainId));
            }
        }

        for (const {
            domainId,
            baseDomain,
            certResolver,
            preferWildcardCert
        } of configDomains) {
            if (existingDomainKeys.has(domainId)) {
                await trx
                    .update(domains)
                    .set({
                        baseDomain,
                        verified: true,
                        type: "wildcard",
                        certResolver,
                        preferWildcardCert
                    })
                    .where(eq(domains.domainId, domainId));

                // delete the dns records and add them again to ensure they are correct
                await trx
                    .delete(dnsRecords)
                    .where(eq(dnsRecords.domainId, domainId));

                await trx.insert(dnsRecords).values([
                    {
                        domainId,
                        recordType: "A",
                        baseDomain,
                        value: "Server IP Address",
                        verified: true
                    },
                    {
                        domainId,
                        recordType: "A",
                        baseDomain: `*.${baseDomain}`,
                        value: "Server IP Address",
                        verified: true
                    }
                ]);
            } else {
                await trx.insert(domains).values({
                    domainId,
                    baseDomain,
                    configManaged: true,
                    type: "wildcard",
                    verified: true,
                    certResolver,
                    preferWildcardCert
                });

                await trx.insert(dnsRecords).values([
                    {
                        domainId,
                        recordType: "A",
                        baseDomain,
                        value: "Server IP Address",
                        verified: true
                    },
                    {
                        domainId,
                        recordType: "A",
                        baseDomain: `*.${baseDomain}`,
                        value: "Server IP Address",
                        verified: true
                    }
                ]);
            }
        }

        const allOrgs = await trx.select().from(orgs);

        const existingOrgDomains = await trx.select().from(orgDomains);
        const existingOrgDomainSet = new Set(
            existingOrgDomains.map((od) => `${od.orgId}-${od.domainId}`)
        );

        const newOrgDomains = [];
        for (const org of allOrgs) {
            for (const domain of configDomains) {
                const key = `${org.orgId}-${domain.domainId}`;
                if (!existingOrgDomainSet.has(key)) {
                    newOrgDomains.push({
                        orgId: org.orgId,
                        domainId: domain.domainId
                    });
                }
            }
        }

        if (newOrgDomains.length > 0) {
            await trx.insert(orgDomains).values(newOrgDomains).execute();
        }
    });

    await db.transaction(async (trx) => {
        const allResources = await trx
            .select()
            .from(resources)
            .leftJoin(domains, eq(domains.domainId, resources.domainId));

        for (const { resources: resource, domains: domain } of allResources) {
            if (!resource || !domain) {
                continue;
            }

            if (!domain.configManaged) {
                continue;
            }

            let fullDomain = "";
            if (!resource.subdomain) {
                fullDomain = domain.baseDomain;
            } else {
                fullDomain = `${resource.subdomain}.${domain.baseDomain}`;
            }

            await trx
                .update(resources)
                .set({ fullDomain })
                .where(eq(resources.resourceId, resource.resourceId));
        }
    });
}
