import { and, eq, inArray } from "drizzle-orm";
import { db, Transaction, userOrgs, users } from "@server/db";
import { UserType } from "@server/types/UserTypes";
import logger from "@server/logger";

/**
 * Converts the existing organization memberships of the users that belong to the
 * given identity provider into IdP-managed memberships when auto provisioning is
 * switched from disabled to enabled (#3973).
 *
 * Memberships created while auto provisioning was disabled are stored as locally
 * managed (`autoProvisioned = false`) so that the OIDC callback never
 * overwrites them. When an administrator later enables auto provisioning, those
 * memberships have to be converted to IdP-managed (`autoProvisioned = true`)
 * otherwise the callback in `server/routers/idp/validateOidcCallback.ts` keeps
 * ignoring them and the existing users are never synchronized.
 *
 * Only the `false -> true` transition converts memberships. All other
 * transitions (`false -> false`, `true -> true`, `true -> false`) are no-ops so
 * that locally managed memberships are never overwritten and existing role
 * ownership is preserved.
 *
 * The conversion is scoped to the given IdP and only affects OIDC users of that
 * IdP. It runs inside the caller's transaction so that the IdP configuration
 * change and the membership conversion commit or roll back together.
 *
 * Returns the number of memberships converted, or `null` when the update does
 * not represent a `false -> true` transition.
 *
 * Known limitation: the `userOrgs` table has no ownership column, so it cannot
 * distinguish a legacy OIDC-created membership that should now become
 * IdP-managed from a membership that an administrator intentionally created or
 * retained as locally managed for an OIDC user of this IdP. Every
 * `autoProvisioned = false` membership of every OIDC user of the affected IdP
 * is therefore converted. The scope is deliberately limited to the users of the
 * affected IdP and never touches users of other IdPs or non-OIDC users.
 */
export async function convertMembershipsOnAutoProvisionEnabled(
    idpId: number,
    previousAutoProvision: boolean,
    requestedAutoProvision: boolean | undefined,
    trx: Transaction | typeof db = db
): Promise<number | null> {
    // Only the disabled -> enabled transition converts memberships.
    if (requestedAutoProvision !== true || previousAutoProvision !== false) {
        return null;
    }

    const converted = await trx
        .update(userOrgs)
        .set({ autoProvisioned: true })
        .where(
            and(
                eq(userOrgs.autoProvisioned, false),
                inArray(
                    userOrgs.userId,
                    trx
                        .select({ userId: users.userId })
                        .from(users)
                        .where(
                            and(
                                eq(users.idpId, idpId),
                                eq(users.type, UserType.OIDC)
                            )
                        )
                )
            )
        )
        .returning({ userId: userOrgs.userId });

    logger.debug(
        "Converted existing memberships to IdP-managed after enabling auto provisioning",
        {
            idpId,
            previousAutoProvision,
            autoProvision: requestedAutoProvision,
            membershipsConverted: converted.length
        }
    );

    return converted.length;
}
