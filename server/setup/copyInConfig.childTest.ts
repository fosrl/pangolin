import "@server/extendZod";
import { db, dnsRecords, domains } from "@server/db";
import { copyInConfig } from "@server/setup/copyInConfig";

async function main() {
    await db.insert(domains).values([
        {
            domainId: "domain1",
            baseDomain: "example.com",
            configManaged: true,
            type: "wildcard",
            verified: true
        },
        {
            domainId: "ns_domain",
            baseDomain: "delegated.example.org",
            configManaged: false,
            type: "ns",
            verified: true
        }
    ]);

    await db.insert(dnsRecords).values([
        {
            domainId: "domain1",
            recordType: "A",
            baseDomain: "example.com",
            value: "Server IP Address",
            verified: true
        },
        {
            domainId: "ns_domain",
            recordType: "NS",
            baseDomain: "delegated.example.org",
            value: "ns1.example.org",
            verified: true
        }
    ]);

    await copyInConfig();

    const remainingDomains = await db.select().from(domains);
    const remainingDnsRecords = await db.select().from(dnsRecords);

    console.log(
        "OBSERVATIONS " +
            JSON.stringify({
                domainIds: remainingDomains.map((d) => d.domainId),
                dnsRecordDomainIds: remainingDnsRecords.map((r) => r.domainId)
            })
    );
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
