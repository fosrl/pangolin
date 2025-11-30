import { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { db, Domain, domains, OrgDomains, orgDomains, dnsRecords } from "@server/db";
import response from "@server/lib/response";
import HttpCode from "@server/types/HttpCode";
import createHttpError from "http-errors";
import logger from "@server/logger";
import { fromError } from "zod-validation-error";
import { subdomainSchema } from "@server/lib/schemas";
import { generateId } from "@server/auth/sessions/app";
import { eq, and } from "drizzle-orm";
import { usageService } from "@server/lib/billing/usageService";
import { FeatureId } from "@server/lib/billing";
import { isSecondLevelDomain, isValidDomain } from "@server/lib/validators";
import { build } from "@server/build";
import config from "@server/lib/config";

const paramsSchema = z
    .object({
        orgId: z.string()
    })
    .strict();

const bodySchema = z
    .object({
        type: z.enum(["ns", "cname", "wildcard"]),
        baseDomain: subdomainSchema,
        certResolver: z.string().optional().nullable(),
        preferWildcardCert: z.boolean().optional().nullable() // optional, only for wildcard
    })
    .strict();


export type CreateDomainResponse = {
    domainId: string;
    nsRecords?: string[];
    cnameRecords?: { baseDomain: string; value: string }[];
    aRecords?: { baseDomain: string; value: string }[];
    txtRecords?: { baseDomain: string; value: string }[];
    certResolver?: string | null;
    preferWildcardCert?: boolean | null;
};

// Helper to check if a domain is a subdomain or equal to another domain
function isSubdomainOrEqual(a: string, b: string): boolean {
    const aParts = a.toLowerCase().split(".");
    const bParts = b.toLowerCase().split(".");
    if (aParts.length < bParts.length) return false;
    return aParts.slice(-bParts.length).join(".") === bParts.join(".");
}

export async function createOrgDomain(
    req: Request,
    res: Response,
    next: NextFunction
): Promise<any> {
    try {
        const parsedBody = bodySchema.safeParse(req.body);
        if (!parsedBody.success) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    fromError(parsedBody.error).toString()
                )
            );
        }

        const parsedParams = paramsSchema.safeParse(req.params);
        if (!parsedParams.success) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    fromError(parsedParams.error).toString()
                )
            );
        }

        const { orgId } = parsedParams.data;
        const { type, baseDomain, certResolver, preferWildcardCert } = parsedBody.data;

        if (build == "oss") {
            if (type !== "wildcard") {
                return next(
                    createHttpError(
                        HttpCode.NOT_IMPLEMENTED,
                        "Creating NS or CNAME records is not supported"
                    )
                );
            }
        } else if (build == "saas") {
            if (type !== "ns" && type !== "cname") {
                return next(
                    createHttpError(
                        HttpCode.BAD_REQUEST,
                        "Invalid domain type. Only NS, CNAME are allowed."
                    )
                );
            }
        }
        // allow wildacard, cname, and ns in enterprise

        // Validate organization exists
        if (!isValidDomain(baseDomain)) {
            return next(
                createHttpError(HttpCode.BAD_REQUEST, "Invalid domain format")
            );
        }

        if (isSecondLevelDomain(baseDomain) && type == "cname") {
            // many providers dont allow cname for this. Lets prevent it for the user for now
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    "You cannot create a CNAME record on a root domain. RFC 1912 § 2.4 prohibits CNAME records at the zone apex. Please use a subdomain."
                )
            );
        }

        if (build == "saas") {
            const usage = await usageService.getUsage(orgId, FeatureId.DOMAINS);
            if (!usage) {
                return next(
                    createHttpError(
                        HttpCode.NOT_FOUND,
                        "No usage data found for this organization"
                    )
                );
            }
            const rejectDomains = await usageService.checkLimitSet(
                orgId,
                false,
                FeatureId.DOMAINS,
                {
                    ...usage,
                    instantaneousValue: (usage.instantaneousValue || 0) + 1
                } // We need to add one to know if we are violating the limit
            );
            if (rejectDomains) {
                return next(
                    createHttpError(
                        HttpCode.FORBIDDEN,
                        "Domain limit exceeded. Please upgrade your plan."
                    )
                );
            }
        }

        let numOrgDomains: OrgDomains[] | undefined;
        let aRecords: CreateDomainResponse["aRecords"];
        let cnameRecords: CreateDomainResponse["cnameRecords"];
        let txtRecords: CreateDomainResponse["txtRecords"];
        let nsRecords: CreateDomainResponse["nsRecords"];
        let returned: Domain | undefined;

        await db.transaction(async (trx) => {
            const [existing] = await trx
                .select()
                .from(domains)
                .where(
                    and(
                        eq(domains.baseDomain, baseDomain),
                        eq(domains.type, type)
                    )
                )
                .leftJoin(
                    orgDomains,
                    eq(orgDomains.domainId, domains.domainId)
                );

            if (existing) {
                const {
                    domains: existingDomain,
                    orgDomains: existingOrgDomain
                } = existing;

                // user alrady added domain to this account
                // always reject
                if (existingOrgDomain?.orgId === orgId) {
                    return next(
                        createHttpError(
                            HttpCode.BAD_REQUEST,
                            "Domain is already added to this org"
                        )
                    );
                }

                // domain already exists elsewhere
                // check if it's already fully verified
                if (existingDomain.verified) {
                    return next(
                        createHttpError(
                            HttpCode.BAD_REQUEST,
                            "Domain is already verified to an org"
                        )
                    );
                }
            }

            // --- Domain overlap logic ---
            // Only consider existing verified domains
            const verifiedDomains = await trx
                .select()
                .from(domains)
                .where(eq(domains.verified, true));

            if (type == "cname") {
                // Block if a verified CNAME exists at the same name
                const cnameExists = verifiedDomains.some(
                    (d) => d.type === "cname" && d.baseDomain === baseDomain
                );
                if (cnameExists) {
                    return next(
                        createHttpError(
                            HttpCode.BAD_REQUEST,
                            `A CNAME record already exists for ${baseDomain}. Only one CNAME record is allowed per domain.`
                        )
                    );
                }
                // Block if a verified NS exists at or below (same or subdomain)
                const nsAtOrBelow = verifiedDomains.some(
                    (d) =>
                        d.type === "ns" &&
                        (isSubdomainOrEqual(baseDomain, d.baseDomain) ||
                            baseDomain === d.baseDomain)
                );
                if (nsAtOrBelow) {
                    return next(
                        createHttpError(
                            HttpCode.BAD_REQUEST,
                            `A nameserver (NS) record exists at or below ${baseDomain}. You cannot create a CNAME record here.`
                        )
                    );
                }
            } else if (type == "ns") {
                // Block if a verified NS exists at or below (same or subdomain)
                const nsAtOrBelow = verifiedDomains.some(
                    (d) =>
                        d.type === "ns" &&
                        (isSubdomainOrEqual(baseDomain, d.baseDomain) ||
                            baseDomain === d.baseDomain)
                );
                if (nsAtOrBelow) {
                    return next(
                        createHttpError(
                            HttpCode.BAD_REQUEST,
                            `A nameserver (NS) record already exists at or below ${baseDomain}. You cannot create another NS record here.`
                        )
                    );
                }
            } else if (type == "wildcard") {
                // TODO: Figure out how to handle wildcards
            }

            const domainId = generateId(15);

            const [insertedDomain] = await trx
                .insert(domains)
                .values({
                    domainId,
                    baseDomain,
                    type,
                    verified: type === "wildcard" ? true : false,
                    certResolver: certResolver || null,
                    preferWildcardCert: preferWildcardCert || false
                })
                .returning();

            returned = insertedDomain;

            // add domain to account
            await trx
                .insert(orgDomains)
                .values({
                    orgId,
                    domainId
                })
                .returning();

            // Prepare DNS records to insert
            const recordsToInsert = [];

            // TODO: This needs to be cross region and not hardcoded
            if (type === "ns") {
                nsRecords = config.getRawConfig().dns.nameservers as string[];
                
                // Save NS records to database
                for (const nsValue of nsRecords) {
                    recordsToInsert.push({
                        domainId,
                        recordType: "NS",
                        baseDomain: baseDomain,
                        value: nsValue,
                        verified: false
                    });
                }
            } else if (type === "cname") {
                cnameRecords = [
                    {
                        value: `${domainId}.${config.getRawConfig().dns.cname_extension}`,
                        baseDomain: baseDomain
                    },
                    {
                        value: `_acme-challenge.${domainId}.${config.getRawConfig().dns.cname_extension}`,
                        baseDomain: `_acme-challenge.${baseDomain}`
                    }
                ];
                
                // Save CNAME records to database
                for (const cnameRecord of cnameRecords) {
                    recordsToInsert.push({
                        domainId,
                        recordType: "CNAME",
                        baseDomain: cnameRecord.baseDomain,
                        value: cnameRecord.value,
                        verified: false
                    });
                }
            } else if (type === "wildcard") {
                aRecords = [
                    {
                        value: `Server IP Address`,
                        baseDomain: `*.${baseDomain}`
                    },
                    {
                        value: `Server IP Address`,
                        baseDomain: `${baseDomain}`
                    }
                ];
                
                // Save A records to database
                for (const aRecord of aRecords) {
                    recordsToInsert.push({
                        domainId,
                        recordType: "A",
                        baseDomain: aRecord.baseDomain,
                        value: aRecord.value,
                        verified: true
                    });
                }
            }

            // Insert all DNS records in batch
            if (recordsToInsert.length > 0) {
                await trx.insert(dnsRecords).values(recordsToInsert);
            }

            numOrgDomains = await trx
                .select()
                .from(orgDomains)
                .where(eq(orgDomains.orgId, orgId));
        });

        if (numOrgDomains) {
            await usageService.updateDaily(
                orgId,
                FeatureId.DOMAINS,
                numOrgDomains.length
            );
        }

        if (!returned) {
            return next(
                createHttpError(
                    HttpCode.INTERNAL_SERVER_ERROR,
                    "Failed to create domain"
                )
            );
        }

        return response<CreateDomainResponse>(res, {
            data: {
                domainId: returned.domainId,
                cnameRecords,
                txtRecords,
                nsRecords,
                aRecords,
                certResolver: returned.certResolver,
                preferWildcardCert: returned.preferWildcardCert
            },
            success: true,
            error: false,
            message: "Domain created successfully",
            status: HttpCode.CREATED
        });
    } catch (error) {
        logger.error(error);
        return next(
            createHttpError(HttpCode.INTERNAL_SERVER_ERROR, "An error occurred")
        );
    }
}
