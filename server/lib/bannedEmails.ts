import { inArray } from "drizzle-orm";
import { bannedEmails, db, Transaction } from "@server/db";
import { bannedEmailCandidates } from "@server/lib/bannedEmailsMatch";

/**
 * Whether an address is banned, either exactly, through a "+tag" variant, or
 * by a "@domain" entry for its domain or a parent domain.
 */
export async function isEmailBanned(
    email: string,
    trx: Transaction | typeof db = db
): Promise<boolean> {
    const [hit] = await trx
        .select({ email: bannedEmails.email })
        .from(bannedEmails)
        .where(inArray(bannedEmails.email, bannedEmailCandidates(email)))
        .limit(1);
    return !!hit;
}
