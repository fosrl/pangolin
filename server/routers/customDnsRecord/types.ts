export const CUSTOM_DNS_RECORD_TYPES = [
    "A",
    "AAAA",
    "CNAME",
    "MX",
    "NS",
    "SRV",
    "TXT"
] as const;

export type CustomDnsRecordType = (typeof CUSTOM_DNS_RECORD_TYPES)[number];

// One record as the user sees it: a name, type and settings with one or more
// values (e.g. both nameservers of an NS record). The DNS server answers with
// one resource record per value.
export type CustomDnsRecordRow = {
    customDnsRecordId: number;
    domainId: string;
    name: string;
    fullDomain: string;
    type: CustomDnsRecordType;
    values: string[];
    ttl: number;
    priority: number | null;
    weight: number | null;
    port: number | null;
    enabled: boolean;
    createdAt: number;
    updatedAt: number;
};

export type ListCustomDnsRecordsResponse = {
    records: CustomDnsRecordRow[];
};

export type CreateOrUpdateCustomDnsRecordResponse = CustomDnsRecordRow;

// The values column holds a JSON-encoded string array
export function parseCustomDnsRecordValues(raw: string): string[] {
    try {
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed)
            ? parsed.filter((v): v is string => typeof v === "string")
            : [];
    } catch {
        return [];
    }
}

export function toCustomDnsRecordRow(
    row: Omit<CustomDnsRecordRow, "values"> & { values: string }
): CustomDnsRecordRow {
    return { ...row, values: parseCustomDnsRecordValues(row.values) };
}
