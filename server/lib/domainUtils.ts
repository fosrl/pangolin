import { db } from "@server/db";
import {
    domains,
    orgDomains,
    domainNamespaces,
    loginPage,
    resources,
    Transaction
} from "@server/db";
import { eq, and, like, not, or } from "drizzle-orm";
import { subdomainSchema, wildcardSubdomainSchema } from "@server/lib/schemas";
import { fromError } from "zod-validation-error";
import { build } from "@server/build";
import config from "./config";

export type DomainValidationResult =
    | {
          success: true;
          fullDomain: string;
          subdomain: string | null;
          wildcard: boolean;
      }
    | {
          success: false;
          error: string;
      };

/**
 * Validates a domain and constructs the full domain based on domain type and subdomain.
 *
 * @param domainId - The ID of the domain to validate
 * @param orgId - The organization ID to check domain access
 * @param subdomain - Optional subdomain to append (for ns and wildcard domains)
 * @returns DomainValidationResult with success status and either fullDomain/subdomain or error message
 */
export async function validateAndConstructDomain(
    domainId: string,
    orgId: string,
    subdomain?: string | null
): Promise<DomainValidationResult> {
    try {
        const [domainRes] = await db
            .select()
            .from(domains)
            .where(eq(domains.domainId, domainId))
            .leftJoin(
                orgDomains,
                and(
                    eq(orgDomains.orgId, orgId),
                    eq(orgDomains.domainId, domainId)
                )
            )
            .leftJoin(
                domainNamespaces,
                eq(domainNamespaces.domainId, domainId)
            );

        // Check if domain exists
        if (!domainRes || !domainRes.domains) {
            return {
                success: false,
                error: `Domain with ID ${domainId} not found`
            };
        }

        if (!domainRes.orgDomains && !domainRes.domainNamespaces) {
            return {
                success: false,
                error: `Organization does not have access to domain with ID ${domainId}`
            };
        }

        // Check if domain is verified
        if (!domainRes.domains.verified) {
            return {
                success: false,
                error: `Domain with ID ${domainId} is not verified`
            };
        }

        // Detect wildcard subdomain request
        const isWildcard =
            subdomain !== undefined &&
            subdomain !== null &&
            subdomain.includes("*") &&
            domainRes.domains.type !== "cname";

        // Wildcard subdomains are not allowed on CNAME domains
        if (isWildcard && domainRes.domains.type === "cname") {
            return {
                success: false,
                error: "Wildcard subdomains are not supported for CNAME domains. CNAME domains must use a specific hostname."
            };
        }

        // Wildcard subdomains are not allowed on namespace (provided/free) domains
        if (isWildcard && domainRes.domainNamespaces) {
            return {
                success: false,
                error: "Wildcard subdomains are not supported for provided or free domains. Use a specific subdomain instead."
            };
        }

        if (
            isWildcard &&
            domainRes.domains.type == "wildcard" &&
            !(
                domainRes.domains.preferWildcardCert ||
                config.getRawConfig().traefik.prefer_wildcard_cert
            )
        ) {
            return {
                success: false,
                error: "Wildcard domains are not supported without configuring certificate resolver for wildcard certs and marking it as prefered."
            };
        }

        // Validate wildcard subdomain format
        if (isWildcard) {
            const parsedWildcard = wildcardSubdomainSchema.safeParse(subdomain);
            if (!parsedWildcard.success) {
                return {
                    success: false,
                    error: fromError(parsedWildcard.error).toString()
                };
            }
        }

        // Construct full domain based on domain type
        let fullDomain = "";
        let finalSubdomain = subdomain;

        if (domainRes.domains.type === "ns") {
            if (subdomain) {
                if (!isWildcard) {
                    const parsedSubdomain =
                        subdomainSchema.safeParse(subdomain);
                    if (!parsedSubdomain.success) {
                        return {
                            success: false,
                            error: fromError(parsedSubdomain.error).toString()
                        };
                    }
                }
                fullDomain = `${subdomain}.${domainRes.domains.baseDomain}`;
            } else {
                fullDomain = domainRes.domains.baseDomain;
            }
        } else if (domainRes.domains.type === "cname") {
            fullDomain = domainRes.domains.baseDomain;
            finalSubdomain = null; // CNAME domains don't use subdomains
        } else if (domainRes.domains.type === "wildcard") {
            if (subdomain !== undefined && subdomain !== null) {
                if (!isWildcard) {
                    // Validate regular subdomain format for wildcard domains
                    const parsedSubdomain =
                        subdomainSchema.safeParse(subdomain);
                    if (!parsedSubdomain.success) {
                        return {
                            success: false,
                            error: fromError(parsedSubdomain.error).toString()
                        };
                    }
                }
                fullDomain = `${subdomain}.${domainRes.domains.baseDomain}`;
            } else {
                fullDomain = domainRes.domains.baseDomain;
            }
        }

        // If the full domain equals the base domain, set subdomain to null
        if (fullDomain === domainRes.domains.baseDomain) {
            finalSubdomain = null;
        }

        // Convert to lowercase (preserve * as-is)
        fullDomain = fullDomain.toLowerCase();

        return {
            success: true,
            fullDomain,
            subdomain: finalSubdomain ?? null,
            wildcard: isWildcard
        };
    } catch (error) {
        return {
            success: false,
            error: `An error occurred while validating domain: ${error instanceof Error ? error.message : "Unknown error"}`
        };
    }
}

/**
 * Checks whether a given fullDomain conflicts with any existing wildcard resources,
 * or (if the fullDomain is itself a wildcard) whether any existing resources would
 * be matched by it.
 *
 * A wildcard resource with matchBaseDomain also serves the host it sits under,
 * so that host has to be free too. Traefik and badger resolve hosts
 * independently, so two resources claiming one host could authenticate against
 * one and route to the other.
 *
 * @param fullDomain - The fully-constructed domain to check (may contain a leading `*`)
 * @param excludeResourceId - Optional resource ID to exclude from the check (for updates)
 * @param matchBaseDomain - Whether the wildcard `fullDomain` also serves its base host
 * @param trx - Transaction to read through, when called from inside one
 * @returns An object with `conflict: true` and a human-readable `message`, or `conflict: false`
 */
export async function checkWildcardDomainConflict(
    fullDomain: string,
    excludeResourceId?: number,
    matchBaseDomain: boolean = false,
    trx: Transaction | typeof db = db
): Promise<{ conflict: false } | { conflict: true; message: string }> {
    const isWildcard = fullDomain.startsWith("*.");

    if (isWildcard) {
        // e.g. fullDomain = "*.example.com"  →  suffix = ".example.com"
        const suffix = fullDomain.slice(1); // ".example.com"

        // Find any existing non-wildcard resource whose fullDomain ends with this suffix
        // e.g. "test.example.com" or "foo.example.com"
        const conflicting = await trx
            .select({
                resourceId: resources.resourceId,
                fullDomain: resources.fullDomain,
                matchBaseDomain: resources.matchBaseDomain
            })
            .from(resources)
            .where(like(resources.fullDomain, `%${suffix}`));

        const matches = conflicting.filter((r) => {
            if (
                excludeResourceId !== undefined &&
                r.resourceId === excludeResourceId
            ) {
                return false;
            }

            if (!r.fullDomain!.startsWith("*.")) {
                return r.fullDomain!.endsWith(suffix);
            }

            // "*.foo.example.com" serving "foo.example.com" collides with
            // this wildcard, which matches any single label under suffix
            const baseHost = r.fullDomain!.slice(2);
            return (
                r.matchBaseDomain &&
                baseHost.endsWith(suffix) &&
                !baseHost.slice(0, -suffix.length).includes(".")
            );
        });

        if (matches.length > 0) {
            return {
                conflict: true,
                message: `Wildcard domain ${fullDomain} conflicts with existing resource(s): ${matches.map((r) => r.fullDomain).join(", ")}`
            };
        }

        if (matchBaseDomain) {
            return checkBaseHostConflict(
                fullDomain.slice(2),
                excludeResourceId,
                trx
            );
        }
    } else {
        // Specific domain — check if any existing wildcard would match it.
        // e.g. fullDomain = "test.example.com"
        // We look for a wildcard "*.example.com" which means fullDomain ends with ".example.com"
        const dotIndex = fullDomain.indexOf(".");
        if (dotIndex !== -1) {
            const suffix = fullDomain.slice(dotIndex); // ".example.com"
            const wildcardPattern = `*.${fullDomain.slice(dotIndex + 1)}`; // "*.example.com"

            const conflicting = await trx
                .select({
                    resourceId: resources.resourceId,
                    fullDomain: resources.fullDomain
                })
                .from(resources)
                .where(
                    or(
                        eq(resources.fullDomain, wildcardPattern),
                        // "*.test.example.com" serving this host as its base
                        and(
                            eq(resources.fullDomain, `*.${fullDomain}`),
                            eq(resources.matchBaseDomain, true)
                        )
                    )
                );

            const matches = conflicting.filter(
                (r) =>
                    excludeResourceId === undefined ||
                    r.resourceId !== excludeResourceId
            );

            if (matches.length > 0) {
                return {
                    conflict: true,
                    message: `Domain ${fullDomain} conflicts with existing wildcard resource(s): ${matches.map((r) => r.fullDomain).join(", ")}`
                };
            }
        }
    }

    return { conflict: false };
}

// Whether a wildcard resource can take on baseHost in addition to its own
// fullDomain: the same rules as a resource being created at that host.
async function checkBaseHostConflict(
    baseHost: string,
    excludeResourceId: number | undefined,
    trx: Transaction | typeof db
): Promise<{ conflict: false } | { conflict: true; message: string }> {
    const dashboardUrl = config.getRawConfig().app.dashboard_url;
    if (dashboardUrl && new URL(dashboardUrl).hostname === baseHost) {
        return {
            conflict: true,
            message: `Base domain ${baseHost} cannot be the same as the dashboard domain`
        };
    }

    if (build != "oss") {
        const existingLoginPages = await trx
            .select()
            .from(loginPage)
            .where(eq(loginPage.fullDomain, baseHost));

        if (existingLoginPages.length > 0) {
            return {
                conflict: true,
                message: `Login page with base domain ${baseHost} already exists`
            };
        }
    }

    const existingResources = await trx
        .select({ resourceId: resources.resourceId })
        .from(resources)
        .where(eq(resources.fullDomain, baseHost));

    if (existingResources.some((r) => r.resourceId !== excludeResourceId)) {
        return {
            conflict: true,
            message: `Resource with base domain ${baseHost} already exists`
        };
    }

    return checkWildcardDomainConflict(baseHost, excludeResourceId, false, trx);
}
