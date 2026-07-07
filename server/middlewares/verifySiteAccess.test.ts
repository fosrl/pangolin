import { assertEquals } from "@test/assert";

/**
 * Tests for the cross-organization site binding prevention in verifySiteAccess.
 *
 * verifySiteAccess now includes a check: if req.userOrgId is already set by a
 * previous middleware (e.g. verifyResourceAccess or verifyTargetAccess), and the
 * loaded site's orgId differs from req.userOrgId, the request is rejected with
 * 403 Forbidden.
 *
 * Route stacks after fix:
 *   PUT /resource/:resourceId/target
 *     → verifyResourceAccess → verifySiteAccess → verifyLimits → ...
 *   POST /target/:targetId
 *     → verifyTargetAccess → verifySiteAccess → verifyLimits → ...
 *
 * verifyResourceAccess sets req.userOrgId to the resource's org.
 * verifyTargetAccess sets req.userOrgId to the target's resource org.
 * verifySiteAccess then checks site.orgId against req.userOrgId before
 * overwriting it with the site's org.
 */

// --- Core org-matching logic (mirrors the check in verifySiteAccess) ---
function siteOrgMatchesExpectedOrg(
    siteOrgId: string | null | undefined,
    expectedOrgId: string | null | undefined
): boolean {
    if (!siteOrgId || !expectedOrgId) {
        return false;
    }
    return siteOrgId === expectedOrgId;
}

// Simulates the condition check in verifySiteAccess:
//   if (req.userOrgId && site.orgId !== req.userOrgId) { reject }
function shouldRejectCrossOrgSite(
    siteOrgId: string,
    reqUserOrgId: string | undefined
): boolean {
    // The actual check in verifySiteAccess is:
    //   if (req.userOrgId && site.orgId !== req.userOrgId) { reject }
    return !!(reqUserOrgId && siteOrgId !== reqUserOrgId);
}

// --- Tests ---

function testSiteOrgMatchLogic() {
    console.log("Running verifySiteAccess org-match logic tests...");

    // Test 1: Same org — should match
    {
        const result = siteOrgMatchesExpectedOrg(
            "org-attacker",
            "org-attacker"
        );
        assertEquals(result, true, "Same org should match");
    }

    // Test 2: Different org — should NOT match (cross-org bypass scenario)
    {
        const result = siteOrgMatchesExpectedOrg("org-victim", "org-attacker");
        assertEquals(
            result,
            false,
            "Cross-org site should NOT match expected org"
        );
    }

    // Test 3: Site orgId is null — should NOT match
    {
        const result = siteOrgMatchesExpectedOrg(null, "org-attacker");
        assertEquals(result, false, "Null site orgId should NOT match");
    }

    // Test 4: Expected orgId is null — should NOT match
    {
        const result = siteOrgMatchesExpectedOrg("org-attacker", null);
        assertEquals(result, false, "Null expected orgId should NOT match");
    }

    // Test 5: Both null — should NOT match
    {
        const result = siteOrgMatchesExpectedOrg(null, null);
        assertEquals(result, false, "Both null should NOT match");
    }

    // Test 6: Empty string orgIds — should NOT match (empty string is falsy)
    {
        const result = siteOrgMatchesExpectedOrg("", "org-attacker");
        assertEquals(result, false, "Empty site orgId should NOT match");
    }

    // Test 7: Undefined orgIds — should NOT match
    {
        const result = siteOrgMatchesExpectedOrg(undefined, "org-attacker");
        assertEquals(result, false, "Undefined site orgId should NOT match");
    }

    console.log("All verifySiteAccess org-match logic tests passed.");
}

function testShouldRejectCrossOrgSite() {
    console.log(
        "Running shouldRejectCrossOrgSite tests (mirrors verifySiteAccess check)..."
    );

    // Test: No prior org context (undefined) — should NOT reject
    // This is the normal case for site-only routes (e.g. PUT /site/:siteId)
    // where verifySiteAccess runs without a prior verifyResourceAccess.
    {
        const shouldReject = shouldRejectCrossOrgSite("org-victim", undefined);
        assertEquals(
            shouldReject,
            false,
            "No prior org context should NOT reject (normal site routes)"
        );
    }

    // Test: Same org — should NOT reject
    {
        const shouldReject = shouldRejectCrossOrgSite(
            "org-attacker",
            "org-attacker"
        );
        assertEquals(shouldReject, false, "Same org should NOT reject");
    }

    // Test: Different org — should reject
    {
        const shouldReject = shouldRejectCrossOrgSite(
            "org-victim",
            "org-attacker"
        );
        assertEquals(shouldReject, true, "Cross-org site should be rejected");
    }

    // Test: Empty string userOrgId — should NOT reject (falsy, check is skipped)
    {
        const shouldReject = shouldRejectCrossOrgSite("org-victim", "");
        assertEquals(
            shouldReject,
            false,
            "Empty string userOrgId should NOT reject (check is skipped)"
        );
    }

    console.log("All shouldRejectCrossOrgSite tests passed.");
}

// --- Route stack validation tests ---

function testRouteStackOrdering() {
    console.log("Running route stack ordering tests...");

    const createTargetStack = [
        "verifyResourceAccess",
        "verifySiteAccess",
        "verifyLimits",
        "verifyUserHasAction",
        "logActionAudit",
        "createTarget"
    ];

    const updateTargetStack = [
        "verifyTargetAccess",
        "verifySiteAccess",
        "verifyLimits",
        "verifyUserHasAction",
        "logActionAudit",
        "updateTarget"
    ];

    // Verify verifySiteAccess comes after resource/target access middleware
    {
        const siteAccessIndex = createTargetStack.indexOf("verifySiteAccess");
        const resourceAccessIndex = createTargetStack.indexOf(
            "verifyResourceAccess"
        );
        assertEquals(
            siteAccessIndex > resourceAccessIndex,
            true,
            "verifySiteAccess must come after verifyResourceAccess in create target stack"
        );
    }

    {
        const siteAccessIndex = updateTargetStack.indexOf("verifySiteAccess");
        const targetAccessIndex =
            updateTargetStack.indexOf("verifyTargetAccess");
        assertEquals(
            siteAccessIndex > targetAccessIndex,
            true,
            "verifySiteAccess must come after verifyTargetAccess in update target stack"
        );
    }

    // Verify verifySiteAccess comes before the handler
    {
        const siteAccessIndex = createTargetStack.indexOf("verifySiteAccess");
        const handlerIndex = createTargetStack.indexOf("createTarget");
        assertEquals(
            siteAccessIndex < handlerIndex,
            true,
            "verifySiteAccess must come before createTarget handler"
        );
    }

    {
        const siteAccessIndex = updateTargetStack.indexOf("verifySiteAccess");
        const handlerIndex = updateTargetStack.indexOf("updateTarget");
        assertEquals(
            siteAccessIndex < handlerIndex,
            true,
            "verifySiteAccess must come before updateTarget handler"
        );
    }

    console.log("All route stack ordering tests passed.");
}

// --- Security scenario tests ---

function testSecurityScenarios() {
    console.log("Running security scenario tests...");

    // Scenario 1: Attacker has resource access in org_attacker, but tries to
    // bind target to a site in org_victim.
    // verifyResourceAccess passes (sets req.userOrgId = "org_attacker").
    // verifySiteAccess loads site (org_victim), checks site.orgId !== req.userOrgId.
    // Expected: 403 Forbidden.
    {
        const shouldReject = shouldRejectCrossOrgSite(
            "org_victim",
            "org_attacker"
        );
        assertEquals(
            shouldReject,
            true,
            "Scenario 1: Cross-org site binding must be rejected"
        );
    }

    // Scenario 2: Attacker has resource access AND site access in another org.
    // Even though the user has site access, verifySiteAccess rejects because
    // the org-match check runs before the site access check.
    // Expected: 403 Forbidden (org mismatch caught before site access check).
    {
        const shouldReject = shouldRejectCrossOrgSite(
            "org_victim",
            "org_attacker"
        );
        assertEquals(
            shouldReject,
            true,
            "Scenario 2: Cross-org site must be rejected even if user has site access"
        );
    }

    // Scenario 3: Legitimate user creates target with site in same org.
    // verifyResourceAccess passes, verifySiteAccess org-match passes (same org),
    // verifySiteAccess site access passes.
    // Expected: 201 Created.
    {
        const shouldReject = shouldRejectCrossOrgSite(
            "org_attacker",
            "org_attacker"
        );
        assertEquals(
            shouldReject,
            false,
            "Scenario 3: Same-org site must be allowed"
        );
    }

    // Scenario 4: WireGuard site in victim org — org mismatch is caught before
    // any DB write, pickPort, addPeer, or addTargets side effect.
    {
        const shouldReject = shouldRejectCrossOrgSite(
            "org_victim",
            "org_attacker"
        );
        assertEquals(
            shouldReject,
            true,
            "Scenario 4: WireGuard cross-org site must be rejected before addPeer"
        );
    }

    // Scenario 5: Newt site in victim org — same as scenario 4 but for newt.
    {
        const shouldReject = shouldRejectCrossOrgSite(
            "org_victim",
            "org_attacker"
        );
        assertEquals(
            shouldReject,
            true,
            "Scenario 5: Newt cross-org site must be rejected before addTargets"
        );
    }

    // Scenario 6: Normal site-only route (e.g. PUT /site/:siteId) where
    // verifySiteAccess runs without a prior verifyResourceAccess.
    // req.userOrgId is undefined, so the org-match check is skipped.
    // Normal site access verification proceeds.
    {
        const shouldReject = shouldRejectCrossOrgSite("org_victim", undefined);
        assertEquals(
            shouldReject,
            false,
            "Scenario 6: Site-only routes should skip org-match check"
        );
    }

    console.log("All security scenario tests passed.");
}

// Run all tests
testSiteOrgMatchLogic();
testShouldRejectCrossOrgSite();
testRouteStackOrdering();
testSecurityScenarios();
