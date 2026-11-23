import "@server/extendZod";
import { z } from "zod";
import { createSelectSchema } from "drizzle-zod";
import { domains } from "@server/db";

export const DomainSchema = createSelectSchema(domains, {
    baseDomain: (s) =>
        s.openapi({ description: "The domain name, for example example.com." }),
    certResolver: (s) =>
        s.openapi({
            description: "Name of the certificate resolver used for the domain."
        }),
    configManaged: (s) =>
        s.openapi({
            description:
                "Whether the domain comes from the server config file and cannot be edited."
        }),
    customCertResolver: (s) =>
        s.openapi({
            description: "Custom certificate resolver, when one is configured."
        }),
    domainId: (s) => s.openapi({ description: "ID of the domain." }),
    errorMessage: (s) =>
        s.openapi({ description: "Why verification failed, when it did." }),
    failed: (s) =>
        s.openapi({ description: "Whether verification has failed." }),
    lastCheckedAt: (s) =>
        s.openapi({
            description: "Epoch seconds of the last verification attempt."
        }),
    preferWildcardCert: (s) =>
        s.openapi({
            description:
                "Whether a wildcard certificate is preferred over per-host certificates."
        }),
    tries: (s) =>
        s.openapi({ description: "Number of verification attempts made." }),
    type: z.enum(["cname", "ns", "wildcard"]).nullable().openapi({
        description:
            "How the domain is verified and served: ns delegates the whole domain, wildcard serves all subdomains, cname adds individual records."
    }),
    verified: (s) =>
        s.openapi({
            description: "Whether ownership of the domain is verified."
        })
});

export const CheckDomainAvailabilityResponseDataSchema = z.object({
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
export type CheckDomainAvailabilityResponse = z.infer<
    typeof CheckDomainAvailabilityResponseDataSchema
>;
