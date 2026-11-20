import "@server/extendZod";
import { z } from "zod";
import { createSelectSchema } from "drizzle-zod";
import { customDnsRecords } from "@server/db";
import { CUSTOM_DNS_RECORD_TYPES } from "./recordTypes";
export {
    CUSTOM_DNS_RECORD_TYPES,
    type CustomDnsRecordType
} from "./recordTypes";

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

// One record as the user sees it: a name, type and settings with one or more
// values (e.g. both nameservers of an NS record). The DNS server answers with
// one resource record per value.
export const CustomDnsRecordSchema = createSelectSchema(customDnsRecords, {
    createdAt: (s) =>
        s.openapi({
            description: "Epoch milliseconds when the record was created."
        }),
    customDnsRecordId: (s) =>
        s.openapi({ description: "Numeric ID of the custom DNS record." }),
    domainId: (s) =>
        s.openapi({ description: "ID of the domain the record belongs to." }),
    enabled: (s) => s.openapi({ description: "Whether the record is served." }),
    fullDomain: (s) =>
        s.openapi({ description: "Fully qualified name of the record." }),
    name: (s) =>
        s.openapi({ description: "Record name relative to the domain." }),
    port: (s) => s.openapi({ description: "Port, for SRV records." }),
    priority: (s) =>
        s.openapi({ description: "Priority, for MX and SRV records." }),
    ttl: (s) => s.openapi({ description: "Time to live in seconds." }),
    type: z
        .enum(CUSTOM_DNS_RECORD_TYPES)
        .openapi({ description: "DNS record type." }),
    updatedAt: (s) =>
        s.openapi({
            description: "Epoch milliseconds when the record was last updated."
        }),
    weight: (s) => s.openapi({ description: "Weight, for SRV records." })
})
    .omit({ values: true })
    .extend({
        values: z.array(z.string()).openapi({ description: "Record values." })
    });
export type CustomDnsRecordRow = z.infer<typeof CustomDnsRecordSchema>;

export const ListCustomDnsRecordsResponseDataSchema = z.object({
    records: z.array(CustomDnsRecordSchema)
});
export type ListCustomDnsRecordsResponse = z.infer<
    typeof ListCustomDnsRecordsResponseDataSchema
>;

export type CreateOrUpdateCustomDnsRecordResponse = CustomDnsRecordRow;
