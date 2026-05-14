import { sendToClient } from "#dynamic/routers/ws";
import { db, newts, olms } from "@server/db";
import {
    Alias,
    convertSubnetProxyTargetsV2ToV1,
    SubnetProxyTarget,
    SubnetProxyTargetV2
} from "@server/lib/ip";
import { canCompress } from "@server/lib/clientVersionChecks";
import logger from "@server/logger";
import { eq } from "drizzle-orm";
import semver from "semver";

const NEWT_V2_TARGETS_VERSION = ">=1.10.3";

export async function convertTargetsIfNessicary(
    newtId: string,
    targets: SubnetProxyTarget[] | SubnetProxyTargetV2[]
) {
    // get the newt
    const [newt] = await db
        .select()
        .from(newts)
        .where(eq(newts.newtId, newtId));
    if (!newt) {
        throw new Error(`No newt found for id: ${newtId}`);
    }

    // check the semver - only fall back to V1 for known old versions
    if (newt.version && semver.valid(newt.version)) {
        if (!semver.satisfies(newt.version, NEWT_V2_TARGETS_VERSION)) {
            logger.debug(
                `Newt version ${newt.version} does not support targets v2, falling back to v1`
            );
            targets = convertSubnetProxyTargetsV2ToV1(
                targets as SubnetProxyTargetV2[]
            );
        }
    } else if (newt.version) {
        logger.debug(
            `Newt version "${newt.version}" is not valid semver, sending v2 targets`
        );
    }

    return targets;
}

export async function addTargets(
    newtId: string,
    targets: SubnetProxyTarget[] | SubnetProxyTargetV2[],
    version?: string | null
) {
    targets = await convertTargetsIfNessicary(newtId, targets);

    await sendToClient(
        newtId,
        {
            type: `newt/wg/targets/add`,
            data: targets
        },
        { incrementConfigVersion: true, compress: canCompress(version, "newt") }
    );
}

export async function removeTargets(
    newtId: string,
    targets: SubnetProxyTarget[] | SubnetProxyTargetV2[],
    version?: string | null
) {
    targets = await convertTargetsIfNessicary(newtId, targets);

    await sendToClient(
        newtId,
        {
            type: `newt/wg/targets/remove`,
            data: targets
        },
        { incrementConfigVersion: true, compress: canCompress(version, "newt") }
    );
}

export async function updateTargets(
    newtId: string,
    targets: {
        oldTargets: SubnetProxyTarget[] | SubnetProxyTargetV2[];
        newTargets: SubnetProxyTarget[] | SubnetProxyTargetV2[];
    },
    version?: string | null
) {
    // get the newt
    const [newt] = await db
        .select()
        .from(newts)
        .where(eq(newts.newtId, newtId));
    if (!newt) {
        logger.error(`addTargetsL No newt found for id: ${newtId}`);
        return;
    }

    // check the semver - only fall back to V1 for known old versions
    if (newt.version && semver.valid(newt.version)) {
        if (!semver.satisfies(newt.version, NEWT_V2_TARGETS_VERSION)) {
            logger.debug(
                `Newt version ${newt.version} does not support targets v2, falling back to v1`
            );
            targets = {
                oldTargets: convertSubnetProxyTargetsV2ToV1(
                    targets.oldTargets as SubnetProxyTargetV2[]
                ),
                newTargets: convertSubnetProxyTargetsV2ToV1(
                    targets.newTargets as SubnetProxyTargetV2[]
                )
            };
        }
    }

    await sendToClient(
        newtId,
        {
            type: `newt/wg/targets/update`,
            data: {
                oldTargets: targets.oldTargets,
                newTargets: targets.newTargets
            }
        },
        { incrementConfigVersion: true, compress: canCompress(version, "newt") }
    ).catch((error) => {
        logger.warn(`Error sending message:`, error);
    });
}

export async function addPeerData(
    clientId: number,
    siteId: number,
    remoteSubnets: string[],
    aliases: Alias[],
    olmId?: string,
    version?: string | null
) {
    if (!olmId) {
        const [olm] = await db
            .select()
            .from(olms)
            .where(eq(olms.clientId, clientId))
            .limit(1);
        if (!olm) {
            return; // ignore this because an olm might not be associated with the client anymore
        }
        olmId = olm.olmId;
        version = olm.version;
    }

    await sendToClient(
        olmId,
        {
            type: `olm/wg/peer/data/add`,
            data: {
                siteId: siteId,
                remoteSubnets: remoteSubnets,
                aliases: aliases
            }
        },
        { incrementConfigVersion: true, compress: canCompress(version, "olm") }
    ).catch((error) => {
        logger.warn(`Error sending message:`, error);
    });
}

export async function removePeerData(
    clientId: number,
    siteId: number,
    remoteSubnets: string[],
    aliases: Alias[],
    olmId?: string,
    version?: string | null
) {
    if (!olmId) {
        const [olm] = await db
            .select()
            .from(olms)
            .where(eq(olms.clientId, clientId))
            .limit(1);
        if (!olm) {
            return;
        }
        olmId = olm.olmId;
        version = olm.version;
    }

    await sendToClient(
        olmId,
        {
            type: `olm/wg/peer/data/remove`,
            data: {
                siteId: siteId,
                remoteSubnets: remoteSubnets,
                aliases: aliases
            }
        },
        { incrementConfigVersion: true, compress: canCompress(version, "olm") }
    ).catch((error) => {
        logger.warn(`Error sending message:`, error);
    });
}

export async function updatePeerData(
    clientId: number,
    siteId: number,
    remoteSubnets:
        | {
              oldRemoteSubnets: string[];
              newRemoteSubnets: string[];
          }
        | undefined,
    aliases:
        | {
              oldAliases: Alias[];
              newAliases: Alias[];
          }
        | undefined,
    olmId?: string,
    version?: string | null
) {
    if (!olmId) {
        const [olm] = await db
            .select()
            .from(olms)
            .where(eq(olms.clientId, clientId))
            .limit(1);
        if (!olm) {
            return;
        }
        olmId = olm.olmId;
        version = olm.version;
    }

    await sendToClient(
        olmId,
        {
            type: `olm/wg/peer/data/update`,
            data: {
                siteId: siteId,
                ...remoteSubnets,
                ...aliases
            }
        },
        { incrementConfigVersion: true, compress: canCompress(version, "olm") }
    ).catch((error) => {
        logger.warn(`Error sending message:`, error);
    });
}
