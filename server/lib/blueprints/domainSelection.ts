export type DomainCandidate = {
    baseDomain: string;
    type: string | null;
};

export function matchesFullDomain(
    domain: DomainCandidate,
    fullDomain: string
): boolean {
    if (domain.type === "ns" || domain.type === "wildcard") {
        return (
            fullDomain === domain.baseDomain ||
            fullDomain.endsWith(`.${domain.baseDomain}`)
        );
    }

    if (domain.type === "cname") {
        return fullDomain === domain.baseDomain;
    }

    return false;
}

// Pick the most specific (longest baseDomain) match so that, e.g.,
// somename.int.example.com is assigned to *.int.example.com rather than to
// *.example.com.
export function selectMostSpecificDomain<
    T extends { domains: DomainCandidate }
>(candidates: T[], fullDomain: string): T | undefined {
    return candidates
        .filter((candidate) => matchesFullDomain(candidate.domains, fullDomain))
        .sort(
            (a, b) => b.domains.baseDomain.length - a.domains.baseDomain.length
        )[0];
}
