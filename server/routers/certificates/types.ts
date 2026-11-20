import "@server/extendZod";
import { z } from "zod";
import { createSelectSchema } from "drizzle-zod";
import { DomainSchema } from "@server/routers/domain/types";
import { certificates } from "@server/db";

export type GetBatchedCertificateResponse = Record<
    string,
    GetCertificateResponse | null
>;

export const GetCertificateResponseDataSchema = createSelectSchema(
    certificates,
    {
        certId: (s) =>
            s.openapi({ description: "Numeric ID of the certificate." }),
        domain: (s) =>
            s.openapi({ description: "Domain the certificate is issued for." }),
        wildcard: (s) =>
            s.openapi({
                description:
                    "Whether the certificate is a wildcard certificate."
            }),
        status: (s) =>
            s.openapi({
                description:
                    "Certificate state: pending, requested, valid, expired or failed."
            }),
        expiresAt: (s) =>
            s.openapi({
                description: "Unix timestamp when the certificate expires."
            }),
        lastRenewalAttempt: (s) =>
            s.openapi({
                description: "Unix timestamp of the last renewal attempt."
            }),
        createdAt: (s) =>
            s.openapi({
                description: "Unix timestamp when the certificate was created."
            }),
        updatedAt: (s) =>
            s.openapi({
                description:
                    "Unix timestamp when the certificate was last updated."
            }),
        errorMessage: (s) =>
            s.openapi({
                description:
                    "Why issuing or renewing the certificate failed, when it did."
            }),
        renewalCount: (s) =>
            s.openapi({
                description: "Number of times the certificate has been renewed."
            })
    }
)
    .pick({
        certId: true,
        domain: true,
        wildcard: true,
        status: true,
        expiresAt: true,
        lastRenewalAttempt: true,
        createdAt: true,
        updatedAt: true,
        errorMessage: true,
        renewalCount: true
    })
    .extend({
        domainType: z.object({
            domainId: z.string().openapi({ description: "ID of the domain." }),
            baseDomain: z.string().openapi({
                description: "The domain name, for example example.com."
            }),
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
            tries: z.number().int().openapi({
                description: "Number of verification attempts made."
            }),
            certResolver: z.string().nullable().openapi({
                description:
                    "Name of the certificate resolver used for the domain."
            }),
            customCertResolver: z.string().nullable().openapi({
                description:
                    "Custom certificate resolver, when one is configured."
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
        }).shape.type
    });

export type GetCertificateResponse = z.infer<
    typeof GetCertificateResponseDataSchema
>;
