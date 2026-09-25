import logger from "@server/logger";

// Rule values are validated with trim().toUpperCase() (see
// getResourceRuleValueValidationError) but stored as sent, so " all " or
// "as13335" can reach the matcher. Normalize the same way here.
function normalizeAsnRuleValue(checkAsn: string): string {
    return checkAsn.trim().toUpperCase();
}

export function isAllAsnSelector(checkAsn: string): boolean {
    const normalized = normalizeAsnRuleValue(checkAsn);
    return normalized === "ALL" || normalized === "AS0";
}

export async function isIpInAsn(
    ipAsn: number | undefined,
    checkAsn: string
): Promise<boolean> {
    // Handle "ALL" special case
    if (isAllAsnSelector(checkAsn)) {
        return true;
    }

    if (!ipAsn) {
        return false;
    }

    // Normalize the check ASN - remove "AS" prefix if present and convert to number
    const normalizedCheckAsn = normalizeAsnRuleValue(checkAsn).replace(
        /^AS/,
        ""
    );
    const checkAsnNumber = parseInt(normalizedCheckAsn, 10);

    if (isNaN(checkAsnNumber)) {
        logger.warn(`Invalid ASN format in rule: ${checkAsn}`);
        return false;
    }

    const match = ipAsn === checkAsnNumber;
    logger.debug(
        `ASN check: IP ASN ${ipAsn} ${match ? "matches" : "does not match"} rule ASN ${checkAsnNumber}`
    );

    return match;
}
