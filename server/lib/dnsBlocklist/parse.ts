// Parsing of domain lists. Kept free of imports so it is cheap to test.

// Names that appear in hosts files but are not domains to block.
const IGNORED_HOSTS = new Set([
    "localhost",
    "localhost.localdomain",
    "local",
    "broadcasthost",
    "ip6-localhost",
    "ip6-loopback",
    "ip6-localnet",
    "ip6-mcastprefix",
    "ip6-allnodes",
    "ip6-allrouters",
    "ip6-allhosts",
    "0.0.0.0"
]);

const HOSTNAME_RE =
    /^(?=.{3,253}$)([a-z0-9_]([a-z0-9_-]{0,61}[a-z0-9_])?\.)+[a-z][a-z0-9-]{1,62}$/;
const IP_RE = /^[0-9a-f.:]+$/i;

/**
 * Normalizes and validates one domain. Returns null when it is not a usable
 * domain name.
 */
export function normalizeDomain(raw: string): string | null {
    let d = raw.trim().toLowerCase();
    if (d.endsWith(".")) d = d.slice(0, -1);
    if (!d || IGNORED_HOSTS.has(d) || !HOSTNAME_RE.test(d)) return null;
    return d;
}

/**
 * Extracts domains from text in hosts format ("0.0.0.0 example.com", with
 * comments) or a plain list of domains, one or more per line.
 */
export function parseDomains(text: string): Set<string> {
    const domains = new Set<string>();
    for (const rawLine of text.split(/\r?\n/)) {
        const hash = rawLine.indexOf("#");
        const line = (hash === -1 ? rawLine : rawLine.slice(0, hash)).trim();
        if (!line) continue;

        let tokens = line.split(/\s+/);
        // "0.0.0.0 example.com": the first token is the address being mapped
        if (tokens.length > 1 && IP_RE.test(tokens[0])) {
            tokens = tokens.slice(1);
        }
        for (const token of tokens) {
            const domain = normalizeDomain(token);
            if (domain) domains.add(domain);
        }
    }
    return domains;
}
