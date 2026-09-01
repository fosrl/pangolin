import { certificates, db, domainNamespaces, domains, orgDomains } from "@server/db";
import response from "@server/lib/response";
import logger from "@server/logger";
import { type GetBatchedCertificateResponse } from "@server/routers/certificates/types";
import HttpCode from "@server/types/HttpCode";
import { and, eq, inArray, isNotNull, or } from "drizzle-orm";
import { NextFunction, Request, Response } from "express";
import createHttpError from "http-errors";
import { z } from "zod";
import { fromError } from "zod-validation-error";

const getCertificateParamSchema = z.strictObject({
    orgId: z.string()
});

const getCertificateQuerySchema = z.object({
    domains: z.preprocess(
        (val) => {
            if (val === undefined || val === null || val === "") {
                return undefined;
            }
            if (Array.isArray(val)) {
                return val;
            }
            // the array is returned as this
            if (typeof val === "string") {
                return val.split(",");
            }
            return undefined;
        },
        z.array(z.string().min(1).max(255))
    )
});

async function query(orgId: string, domainList: string[]) {
    // Try to get CNAME certificates first
    const existingCertificates = await db
        .select({
            certId: certificates.certId,
            domain: certificates.domain,
            wildcard: certificates.wildcard,
            status: certificates.status,
            expiresAt: certificates.expiresAt,
            lastRenewalAttempt: certificates.lastRenewalAttempt,
            createdAt: certificates.createdAt,
            updatedAt: certificates.updatedAt,
            errorMessage: certificates.errorMessage,
            renewalCount: certificates.renewalCount,
            domainId: domains.domainId,
            domainType: domains.type
        })
        .from(certificates)
        .innerJoin(domains, eq(certificates.domainId, domains.domainId))
        .leftJoin(
            orgDomains,
            and(
                eq(domains.domainId, orgDomains.domainId),
                eq(orgDomains.orgId, orgId)
            )
        )
        .leftJoin(
            domainNamespaces,
            eq(domains.domainId, domainNamespaces.domainId)
        )
        .where(
            and(
                inArray(certificates.domain, domainList),
                // Namespace domains are shared across all orgs, so they skip
                // the org-ownership check (mirrors verifyCertificateAccess).
                or(
                    isNotNull(orgDomains.orgId),
                    isNotNull(domainNamespaces.domainNamespaceId)
                )
            )
        );

    // All non resolved domain certificates might be `ns` or `wildcard`,
    // which means exact domain certificates do not exist
    const foundDomains = new Set(
        existingCertificates.map((cert) => cert.domain)
    );
    const domainsWithMissingCertificates = domainList.filter(
        (domain) => !foundDomains.has(domain)
    );

    if (domainsWithMissingCertificates.length > 0) {
        const domainLevelDownSet = new Set<string>();
        const wildcardDomainSet = new Set<string>();

        for (const domain of domainsWithMissingCertificates) {
            const domainLevelDown = domain.split(".").slice(1).join(".");
            const wildcardPrefixed = `*.${domainLevelDown}`;
            domainLevelDownSet.add(domainLevelDown);
            wildcardDomainSet.add(wildcardPrefixed);
        }

        // Need to map the certificates to each domain
        const wildcardCertificates = await db
            .select({
                certId: certificates.certId,
                domain: certificates.domain,
                wildcard: certificates.wildcard,
                status: certificates.status,
                expiresAt: certificates.expiresAt,
                lastRenewalAttempt: certificates.lastRenewalAttempt,
                createdAt: certificates.createdAt,
                updatedAt: certificates.updatedAt,
                errorMessage: certificates.errorMessage,
                renewalCount: certificates.renewalCount,
                domainId: domains.domainId,
                domainType: domains.type
            })
            .from(certificates)
            .innerJoin(domains, eq(certificates.domainId, domains.domainId))
            .leftJoin(
                orgDomains,
                and(
                    eq(domains.domainId, orgDomains.domainId),
                    eq(orgDomains.orgId, orgId)
                )
            )
            .leftJoin(
                domainNamespaces,
                eq(domains.domainId, domainNamespaces.domainId)
            )
            .where(
                and(
                    eq(certificates.wildcard, true),
                    or(
                        inArray(certificates.domain, [...domainLevelDownSet]),
                        inArray(certificates.domain, [...wildcardDomainSet])
                    ),
                    or(
                        isNotNull(orgDomains.orgId),
                        isNotNull(domainNamespaces.domainNamespaceId)
                    )
                )
            );

        existingCertificates.push(...wildcardCertificates);
    }

    const certificateMap: Record<string, any> = {};
    for (const domain of domainList) {
        const domainLevelDown = domain.split(".").slice(1).join(".");
        const wildcardPrefixed = `*.${domainLevelDown}`;

        certificateMap[domain] =
            existingCertificates.find(
                (cert) =>
                    cert.domain === domain ||
                    cert.domain === domainLevelDown ||
                    cert.domain === wildcardPrefixed
            ) ?? null;
    }

    return certificateMap;
}

export async function getBatchedCertificates(
    req: Request,
    res: Response,
    next: NextFunction
): Promise<any> {
    try {
        const parsedParams = getCertificateParamSchema.safeParse(req.params);
        if (!parsedParams.success) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    fromError(parsedParams.error).toString()
                )
            );
        }

        const { orgId } = parsedParams.data;
        const parsedQuery = getCertificateQuerySchema.safeParse(req.query);
        if (!parsedQuery.success) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    fromError(parsedQuery.error).toString()
                )
            );
        }

        const { domains } = parsedQuery.data;

        const cert = await query(orgId, domains);

        return response<GetBatchedCertificateResponse>(res, {
            data: cert,
            success: true,
            error: false,
            message: "Certificates retrieved successfully",
            status: HttpCode.OK
        });
    } catch (error) {
        logger.error(error);
        return next(
            createHttpError(HttpCode.INTERNAL_SERVER_ERROR, "An error occurred")
        );
    }
}
