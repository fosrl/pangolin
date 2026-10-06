import { sendToClientsBatch } from "#dynamic/routers/ws";
import { db, olms } from "@server/db";
import { canCompress } from "@server/lib/clientVersionChecks";
import logger from "@server/logger";
import { inArray } from "drizzle-orm";

// The olm only tracks which gateway (exit node) site resource it selected, by
// its numeric siteResourceId, and the site IDs that resource currently
// resolves to. So all the server has to push is what changed for that one
// resource; the olm ignores a message whose siteResourceId isn't the one it
// selected, which stops a site added to some other gateway resource from
// being pulled into the client's gateway set. (Creates aren't pushed: a
// client has to select a gateway resource before it can be using it.)

async function sendGatewayMessageToClients(
    clientIds: number[],
    type: string,
    data: Record<string, unknown>
): Promise<void> {
    const uniqueClientIds = Array.from(new Set(clientIds));
    if (uniqueClientIds.length === 0) {
        return;
    }

    const olmRows = await db
        .select({
            olmId: olms.olmId,
            version: olms.version
        })
        .from(olms)
        .where(inArray(olms.clientId, uniqueClientIds));

    const payloads = olmRows.map((olm) => ({
        clientId: olm.olmId,
        message: { type, data },
        options: {
            compress: canCompress(olm.version, "olm"),
            incrementConfigVersion: true
        }
    }));

    if (payloads.length === 0) {
        return;
    }

    await sendToClientsBatch(payloads).catch((error) => {
        logger.error(`Error sending ${type} messages to olms:`, error);
    });
}

// Tells the olms of the given clients that sites were added to / removed from
// the gateway site resource, so those that selected it can adjust the set of
// sites they use as the gateway.
export async function sendGatewaySitesUpdate(
    clientIds: number[],
    siteResourceId: number,
    addedSiteIds: number[],
    removedSiteIds: number[]
): Promise<void> {
    if (addedSiteIds.length === 0 && removedSiteIds.length === 0) {
        return;
    }

    await sendGatewayMessageToClients(
        clientIds,
        "olm/wg/gateway/sites/update",
        { siteResourceId, addedSiteIds, removedSiteIds }
    );
}

// Tells the olms of the given clients that the gateway site resource can no
// longer be used as a gateway (it was deleted, disabled, changed to another
// mode, or the client lost access to it), so those that selected it drop out
// of gateway mode.
export async function sendGatewayDisable(
    clientIds: number[],
    siteResourceId: number
): Promise<void> {
    await sendGatewayMessageToClients(clientIds, "olm/wg/gateway/disable", {
        siteResourceId
    });
}
