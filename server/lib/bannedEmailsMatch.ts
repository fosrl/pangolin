/**
 * The bannedEmails keys an address is checked against: the exact address,
 * the address without a "+tag", and "@domain" for its domain and every parent
 * domain (so "@example.com" also bans "@mail.example.com").
 */
export function bannedEmailCandidates(email: string): string[] {
    const normalized = email.trim().toLowerCase();
    const at = normalized.lastIndexOf("@");
    if (at <= 0 || at === normalized.length - 1) {
        return [normalized];
    }
    const local = normalized.slice(0, at);
    const domain = normalized.slice(at + 1).replace(/\.$/, "");

    const candidates = new Set<string>([normalized]);
    const plus = local.indexOf("+");
    if (plus > 0) {
        candidates.add(`${local.slice(0, plus)}@${domain}`);
    }
    const labels = domain.split(".");
    for (let i = 0; i < labels.length - 1; i++) {
        candidates.add(`@${labels.slice(i).join(".")}`);
    }
    return [...candidates];
}
