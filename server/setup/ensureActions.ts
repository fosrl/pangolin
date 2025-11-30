import { ActionsEnum } from "@server/auth/actions";
import { db, orgs } from "@server/db";
import { actions, roles, roleActions } from "@server/db";
import { eq, inArray } from "drizzle-orm";
import logger from "@server/logger";

export async function ensureActions() {
    await db.transaction(async (trx) => {
        const actionIds = Object.values(ActionsEnum);
        const existingActions = await trx.select().from(actions).execute();
        const existingActionIds = existingActions.map(
            (action) => action.actionId
        );

        const actionsToAdd = actionIds.filter(
            (id) => !existingActionIds.includes(id)
        );
        const actionsToRemove = existingActionIds.filter(
            (id) => !actionIds.includes(id as ActionsEnum)
        );

        const defaultRoles = await trx
            .select()
            .from(roles)
            .where(eq(roles.isAdmin, true))
            .execute();

        const allOrgs = await trx
            .select({ orgId: orgs.orgId })
            .from(orgs)
            .execute();
        const allOrgIds = new Set(allOrgs.map((o) => o.orgId));
        const validRoles = defaultRoles.filter(
            (r) => r.orgId && r.roleId && allOrgIds.has(r.orgId)
        );

        const skipped = defaultRoles.length - validRoles.length;
        if (skipped > 0) {
            logger.warn(`Skipped ${skipped} orphaned admin roles missing orgs`);
        }

        // Add new actions
        for (const actionId of actionsToAdd) {
            logger.debug(`Adding action: ${actionId}`);
            await trx.insert(actions).values({ actionId }).execute();
            // Add new actions to the Default role
            if (validRoles.length != 0) {
                await trx
                    .insert(roleActions)
                    .values(
                        validRoles.map((role) => ({
                            roleId: role.roleId,
                            actionId,
                            orgId: role.orgId
                        }))
                    )
                    .execute();
            }
        }

        // Remove deprecated actions
        if (actionsToRemove.length > 0) {
            logger.debug(`Removing actions: ${actionsToRemove.join(", ")}`);
            await trx
                .delete(roleActions)
                .where(inArray(roleActions.actionId, actionsToRemove))
                .execute();
            await trx
                .delete(actions)
                .where(inArray(actions.actionId, actionsToRemove))
                .execute();
        }
    });
}
