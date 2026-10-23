import {
    db,
    Transaction,
    userInviteRoles,
    userInvites,
    users
} from "@server/db";
import { eq, inArray } from "drizzle-orm";

/**
 * Deletes a user and the rows that belong to that user but are not removed by
 * the foreign key cascade.
 *
 * The sessions, tokens, org memberships and everything else that references
 * the user are removed by the `ON DELETE CASCADE` of the schema. The
 * invitations of a user are stored with the email address of the user and not
 * with the user id, so they have to be removed by hand. Without that the
 * email address of a deleted account stays in use and the account that is
 * created with the same email address is greeted with an invitation that
 * belongs to somebody else.
 */
export async function deleteUser(
    userId: string,
    trx: Transaction | typeof db = db
): Promise<void> {
    const [user] = await trx
        .select({ email: users.email })
        .from(users)
        .where(eq(users.userId, userId));

    if (user?.email) {
        const invites = await trx
            .select({ inviteId: userInvites.inviteId })
            .from(userInvites)
            .where(eq(userInvites.email, user.email));

        if (invites.length > 0) {
            const inviteIds = invites.map((invite) => invite.inviteId);

            await trx
                .delete(userInviteRoles)
                .where(inArray(userInviteRoles.inviteId, inviteIds));
            await trx
                .delete(userInvites)
                .where(inArray(userInvites.inviteId, inviteIds));
        }
    }

    await trx.delete(users).where(eq(users.userId, userId));
}
