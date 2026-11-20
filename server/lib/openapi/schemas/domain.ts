import "@server/extendZod";
import { z } from "zod";

export const DomainSchema = z.object({
    domainId: z.string().openapi({ description: "ID of the domain." }),
    baseDomain: z
        .string()
        .openapi({ description: "The domain name, for example example.com." }),
    configManaged: z.boolean().openapi({
        description:
            "Whether the domain comes from the server config file and cannot be edited."
    }),
    type: z.enum(["cname", "ns", "wildcard"]).nullable().openapi({
        description:
            "How the domain is verified and served: ns delegates the whole domain, wildcard serves all subdomains, cname adds individual records."
    }),
    verified: z.boolean().openapi({
        description: "Whether ownership of the domain is verified."
    }),
    failed: z
        .boolean()
        .openapi({ description: "Whether verification has failed." }),
    tries: z
        .number()
        .int()
        .openapi({ description: "Number of verification attempts made." }),
    certResolver: z.string().nullable().openapi({
        description: "Name of the certificate resolver used for the domain."
    }),
    customCertResolver: z.string().nullable().openapi({
        description: "Custom certificate resolver, when one is configured."
    }),
    preferWildcardCert: z.boolean().nullable().openapi({
        description:
            "Whether a wildcard certificate is preferred over per-host certificates."
    }),
    errorMessage: z.string().nullable().openapi({
        description: "Why verification failed, when it did."
    }),
    lastCheckedAt: z.number().int().nullable().openapi({
        description: "Epoch seconds of the last verification attempt."
    })
});

export const DnsRecordSchema = z.object({
    id: z
        .number()
        .int()
        .openapi({ description: "Numeric ID of the DNS record." }),
    domainId: z
        .string()
        .openapi({ description: "ID of the domain the record belongs to." }),
    baseDomain: z
        .string()
        .nullable()
        .openapi({ description: "Domain the record is for." }),
    recordType: z.string().openapi({
        description: "DNS record type, for example CNAME, A or TXT."
    }),
    value: z.string().openapi({ description: "Value the record must have." }),
    verified: z.boolean().openapi({
        description: "Whether the record was found with the expected value."
    })
});

export const CertificateSchema = z.object({
    certId: z
        .number()
        .int()
        .openapi({ description: "Numeric ID of the certificate." }),
    domain: z
        .string()
        .openapi({ description: "Domain the certificate is issued for." }),
    wildcard: z.boolean().nullable().openapi({
        description: "Whether the certificate is a wildcard certificate."
    }),
    status: z.string().openapi({
        description:
            "Certificate state: pending, requested, valid, expired or failed."
    }),
    expiresAt: z.number().int().nullable().openapi({
        description: "Unix timestamp when the certificate expires."
    }),
    lastRenewalAttempt: z.number().int().nullable().openapi({
        description: "Unix timestamp of the last renewal attempt."
    }),
    createdAt: z.number().int().openapi({
        description: "Unix timestamp when the certificate was created."
    }),
    updatedAt: z.number().int().openapi({
        description: "Unix timestamp when the certificate was last updated."
    }),
    errorMessage: z.string().nullable().openapi({
        description:
            "Why issuing or renewing the certificate failed, when it did."
    }),
    renewalCount: z.number().int().nullable().openapi({
        description: "Number of times the certificate has been renewed."
    }),
    domainType: DomainSchema.shape.type
});

export const CustomDnsRecordSchema = z.object({
    customDnsRecordId: z.number().int().openapi({
        description: "Numeric ID of the custom DNS record."
    }),
    domainId: z
        .string()
        .openapi({ description: "ID of the domain the record belongs to." }),
    name: z
        .string()
        .openapi({ description: "Record name relative to the domain." }),
    fullDomain: z
        .string()
        .openapi({ description: "Fully qualified name of the record." }),
    type: z.enum(["A", "AAAA", "CNAME", "MX", "NS", "SRV", "TXT"]).openapi({
        description: "DNS record type."
    }),
    values: z.array(z.string()).openapi({ description: "Record values." }),
    ttl: z.number().int().openapi({ description: "Time to live in seconds." }),
    priority: z.number().int().nullable().openapi({
        description: "Priority, for MX and SRV records."
    }),
    weight: z
        .number()
        .int()
        .nullable()
        .openapi({ description: "Weight, for SRV records." }),
    port: z
        .number()
        .int()
        .nullable()
        .openapi({ description: "Port, for SRV records." }),
    enabled: z
        .boolean()
        .openapi({ description: "Whether the record is served." }),
    createdAt: z.number().int().openapi({
        description: "Epoch milliseconds when the record was created."
    }),
    updatedAt: z.number().int().openapi({
        description: "Epoch milliseconds when the record was last updated."
    })
});

export const DomainNamespaceOptionsSchema = z.object({
    available: z.boolean().openapi({
        description:
            "Whether at least one domain namespace is available for the requested subdomain."
    }),
    options: z
        .array(
            z.object({
                domainNamespaceId: z
                    .string()
                    .openapi({ description: "ID of the domain namespace." }),
                domainId: z
                    .string()
                    .openapi({ description: "ID of the domain." }),
                fullDomain: z
                    .string()
                    .openapi({ description: "Full domain that can be used." })
            })
        )
        .openapi({
            description: "Domains the requested subdomain can be created on."
        })
});
