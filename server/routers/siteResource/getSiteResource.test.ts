import { assertEquals } from "@test/assert";
import { getSiteResourceParamsSchema } from "./getSiteResource";

function testSiteResourceIdOnlyParams() {
    const result = getSiteResourceParamsSchema.safeParse({
        siteResourceId: "42"
    });

    assertEquals(
        result.success,
        true,
        "siteResourceId-only integration routes should pass validation"
    );

    if (result.success) {
        assertEquals(
            result.data.siteResourceId,
            42,
            "siteResourceId should be parsed as a number"
        );
        assertEquals(
            result.data.orgId,
            undefined,
            "orgId should remain optional"
        );
    }
}

function testOrgScopedParamsRemainSupported() {
    const result = getSiteResourceParamsSchema.safeParse({
        siteResourceId: "42",
        orgId: "org-id"
    });

    assertEquals(
        result.success,
        true,
        "org-scoped routes should continue to pass validation"
    );
}

function testInvalidSiteResourceId() {
    const result = getSiteResourceParamsSchema.safeParse({
        siteResourceId: "not-a-number"
    });

    assertEquals(
        result.success,
        false,
        "non-numeric siteResourceIds should fail validation"
    );
}

testSiteResourceIdOnlyParams();
testOrgScopedParamsRemainSupported();
testInvalidSiteResourceId();

console.log("All getSiteResource parameter validation tests passed.");
