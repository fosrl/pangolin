// What an org may use of DNS blocking. This is the OSS version of
// server/private/lib/dnsBlocklist/entitlements.ts: the ads and malware category
// is a community feature, everything else needs a license or subscription.

export type DnsBlockEntitlements = {
    /** Categories other than ads, which every org has. */
    allCategories: boolean;
    /** Org-defined block lists. */
    customLists: boolean;
    /** Reporting blocked requests to the server for the DNS block log. */
    blockLog: boolean;
};

export async function getDnsBlockEntitlements(
    orgId: string
): Promise<DnsBlockEntitlements> {
    return { allCategories: false, customLists: false, blockLog: false };
}
