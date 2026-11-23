// Kept free of imports on purpose: the dashboard imports this file, so it must
// not pull in the database or the schemas that live in ./types.
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
