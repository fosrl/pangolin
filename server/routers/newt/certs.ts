import { sendToClient } from "#dynamic/routers/ws";
import logger from "@server/logger";
import {
    canCompress,
    supportsCertReferences
} from "@server/lib/clientVersionChecks";
import { CertRef } from "@server/lib/ip";

/**
 * Pushes an incremental set of certs to a newt client outside of a full
 * newt/sync or newt/wg/receive-config, e.g. after a certificate renewal so
 * that every target referencing it (by tlsCertId) picks up the new material
 * without waiting for the next full resync.
 */
export async function sendCertsAdd(
    newtId: string,
    certs: CertRef[],
    version?: string | null
) {
    if (certs.length === 0) {
        return;
    }

    if (!supportsCertReferences(version)) {
        logger.debug(
            `Newt ${newtId} (version ${version}) does not support cert references, skipping certs/add`
        );
        return;
    }

    await sendToClient(
        newtId,
        {
            type: "newt/certs/add",
            data: certs
        },
        {
            incrementConfigVersion: true,
            compress: canCompress(version, "newt")
        }
    );
}

/**
 * Tells a newt client to drop the given cert IDs, e.g. once the server knows
 * no target references them anymore.
 */
export async function sendCertsRemove(
    newtId: string,
    certIds: string[],
    version?: string | null
) {
    if (certIds.length === 0) {
        return;
    }

    if (!supportsCertReferences(version)) {
        logger.debug(
            `Newt ${newtId} (version ${version}) does not support cert references, skipping certs/remove`
        );
        return;
    }

    await sendToClient(
        newtId,
        {
            type: "newt/certs/remove",
            data: { ids: certIds }
        },
        {
            incrementConfigVersion: true,
            compress: canCompress(version, "newt")
        }
    );
}
