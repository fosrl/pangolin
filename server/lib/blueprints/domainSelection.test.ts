import { assertEquals } from "@test/assert";
import { matchesFullDomain, selectMostSpecificDomain } from "./domainSelection";

function candidate(type: string, baseDomain: string) {
    return { domains: { type, baseDomain } };
}

function testMostSpecificDomainWins() {
    console.log("Running most specific domain tests...");

    // Two overlapping wildcard domains, the order is the one returned by the
    // database: the parent domain must not win over the nested one.
    {
        const possibleDomains = [
            candidate("wildcard", "example.com"),
            candidate("wildcard", "int.example.com")
        ];
        const selected = selectMostSpecificDomain(
            possibleDomains,
            "somename.int.example.com"
        );
        const baseDomain = selected?.domains.baseDomain;

        assertEquals(
            baseDomain,
            "int.example.com",
            "Most specific wildcard domain was not selected"
        );
        assertEquals(
            "somename.int.example.com".replace(`.${baseDomain}`, ""),
            "somename",
            "Subdomain was computed from the wrong base domain"
        );
    }

    // The parent domain is still used when it is the only match.
    {
        const selected = selectMostSpecificDomain(
            [candidate("wildcard", "example.com")],
            "app.example.com"
        );

        assertEquals(
            selected?.domains.baseDomain,
            "example.com",
            "Only matching domain was not selected"
        );
    }

    // Namespace domains can serve their own base domain as well.
    {
        const selected = selectMostSpecificDomain(
            [candidate("ns", "example.com")],
            "example.com"
        );

        assertEquals(
            selected?.domains.baseDomain,
            "example.com",
            "Exact base domain match failed"
        );
    }

    // A CNAME domain only matches its exact base domain.
    {
        assertEquals(
            matchesFullDomain(
                { type: "cname", baseDomain: "example.com" },
                "app.example.com"
            ),
            false,
            "CNAME domain matched a subdomain"
        );
        assertEquals(
            matchesFullDomain(
                { type: "cname", baseDomain: "example.com" },
                "example.com"
            ),
            true,
            "CNAME domain did not match its base domain"
        );
    }

    // No verified domain covers the full domain.
    {
        const selected = selectMostSpecificDomain(
            [candidate("wildcard", "example.com")],
            "app.other.com"
        );

        assertEquals(selected, undefined, "Unrelated domain was selected");
    }

    console.log("All most specific domain tests passed!");
}

try {
    testMostSpecificDomainWins();
} catch (error) {
    console.error("Test failed:", error);
    process.exit(1);
}
