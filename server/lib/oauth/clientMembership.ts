import { and, eq } from "drizzle-orm";
import { db, oauthClients, userOrgs, Transaction } from "@server/db";

export async function userBelongsToClientOrg(
    userId: string,
    clientId: string,
    trx: Transaction | typeof db = db
): Promise<boolean> {
    const [membership] = await trx
        .select({ userId: userOrgs.userId })
        .from(oauthClients)
        .innerJoin(userOrgs, eq(oauthClients.orgId, userOrgs.orgId))
        .where(
            and(
                eq(oauthClients.clientId, clientId),
                eq(userOrgs.userId, userId)
            )
        )
        .limit(1);

    return !!membership;
}
