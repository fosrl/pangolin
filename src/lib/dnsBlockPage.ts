// Shared by the public block page and its preview in org settings, so both
// fill in the placeholders the same way.

export type BlockPageVars = {
    domain: string;
    orgName: string;
};

/** Replaces {{domain}} and {{orgName}} in admin-written block page text. */
export function fillBlockPageText(text: string, vars: BlockPageVars): string {
    return text.replace(/\{\{\s*(domain|orgName)\s*\}\}/g, (_, key) =>
        key === "domain" ? vars.domain : vars.orgName
    );
}

const DOMAIN_RE =
    /^(?=.{1,253}$)([a-z0-9_]([a-z0-9_-]{0,61}[a-z0-9_])?\.)+[a-z0-9-]{2,63}$/;

/**
 * The blocked domain from the page's query string, or null when it is missing
 * or not a plain domain name. Only a validated name is shown, so the link
 * cannot be used to put arbitrary text on the page.
 */
export function parseBlockedDomain(value: unknown): string | null {
    if (typeof value !== "string") return null;
    const domain = value.trim().toLowerCase().replace(/\.$/, "");
    return DOMAIN_RE.test(domain) ? domain : null;
}
