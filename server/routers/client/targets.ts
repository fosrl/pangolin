import { sendToClient, sendToClientsBatch } from "#dynamic/routers/ws";
import { db, newts, olms } from "@server/db";
import {
    Alias,
    convertSubnetProxyTargetsV2ToV1,
    SubnetProxyTarget,
    SubnetProxyTargetV2
} from "@server/lib/ip";
import { canCompress } from "@server/lib/clientVersionChecks";
import logger from "@server/logger";
import { eq, inArray } from "drizzle-orm";
import semver from "semver";

const NEWT_V2_TARGETS_VERSION = ">=1.10.3";

export async function convertTargetsIfNecessary(
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

    // check the semver
    if (
        newt.version &&
        !semver.satisfies(newt.version, NEWT_V2_TARGETS_VERSION)
    ) {
        logger.debug(
            `addTargets Newt version ${newt.version} does not support targets v2 falling back`
        );
        targets = convertSubnetProxyTargetsV2ToV1(
            targets as SubnetProxyTargetV2[]
        );
    }

    return targets;
}

export async function addTargets(
    newtId: string,
    targets: SubnetProxyTarget[] | SubnetProxyTargetV2[],
    version?: string | null
) {
    targets = await convertTargetsIfNecessary(newtId, targets);

    await sendToClient(
        newtId,
        {
            type: `newt/wg/targets/add`,
            data: targets
        },
        { incrementConfigVersion: true, compress: canCompress(version, "newt") }
    );
}

export async function addTargetsBatch(
    entries: {
        newtId: string;
        targets: SubnetProxyTarget[] | SubnetProxyTargetV2[];
        version?: string | null;
    }[]
) {
    if (entries.length === 0) {
        return;
    }

    const resolved = await Promise.all(
        entries.map(async (entry) => ({
            ...entry,
            targets: await convertTargetsIfNecessary(
                entry.newtId,
                entry.targets
            )
        }))
    );

    await sendToClientsBatch(
        resolved.map((entry) => ({
            clientId: entry.newtId,
            message: {
                type: `newt/wg/targets/add`,
                data: entry.targets
            },
            options: {
                incrementConfigVersion: true,
                compress: canCompress(entry.version, "newt")
            }
        }))
    );
}

export async function removeTargets(
    newtId: string,
    targets: SubnetProxyTarget[] | SubnetProxyTargetV2[],
    version?: string | null
) {
    targets = await convertTargetsIfNecessary(newtId, targets);

    await sendToClient(
        newtId,
        {
            type: `newt/wg/targets/remove`,
            data: targets
        },
        { incrementConfigVersion: true, compress: canCompress(version, "newt") }
    );
}

export async function removeTargetsBatch(
    entries: {
        newtId: string;
        targets: SubnetProxyTarget[] | SubnetProxyTargetV2[];
        version?: string | null;
    }[]
) {
    if (entries.length === 0) {
        return;
    }

    const resolved = await Promise.all(
        entries.map(async (entry) => ({
            ...entry,
            targets: await convertTargetsIfNecessary(
                entry.newtId,
                entry.targets
            )
        }))
    );

    await sendToClientsBatch(
        resolved.map((entry) => ({
            clientId: entry.newtId,
            message: {
                type: `newt/wg/targets/remove`,
                data: entry.targets
            },
            options: {
                incrementConfigVersion: true,
                compress: canCompress(entry.version, "newt")
            }
        }))
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

    // check the semver
    if (
        newt.version &&
        !semver.satisfies(newt.version, NEWT_V2_TARGETS_VERSION)
    ) {
        logger.debug(
            `addTargets Newt version ${newt.version} does not support targets v2 falling back`
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

const resolveOlmTargets = async (
    entries: {
        clientId: number;
        olmId?: string;
        version?: string | null;
    }[]
) => {
    const unresolvedClientIds = entries
        .filter((entry) => !entry.olmId)
        .map((entry) => entry.clientId);

    const olmMap = new Map<number, { olmId: string; version: string | null }>();

    if (unresolvedClientIds.length > 0) {
        const olmRows = await db
            .select({
                clientId: olms.clientId,
                olmId: olms.olmId,
                version: olms.version
            })
            .from(olms)
            .where(inArray(olms.clientId, unresolvedClientIds));

        for (const row of olmRows) {
            if (row.clientId !== null) {
                olmMap.set(row.clientId, {
                    olmId: row.olmId,
                    version: row.version
                });
            }
        }
    }

    return entries
        .map((entry) => {
            if (entry.olmId) {
                return {
                    clientId: entry.clientId,
                    olmId: entry.olmId,
                    version: entry.version
                };
            }

            const resolved = olmMap.get(entry.clientId);
            if (!resolved) {
                return null;
            }

            return {
                clientId: entry.clientId,
                olmId: resolved.olmId,
                version: entry.version ?? resolved.version
            };
        })
        .filter((entry) => entry !== null);
};

export async function addPeerDataBatch(
    entries: {
        clientId: number;
        siteId: number;
        remoteSubnets: string[];
        aliases: Alias[];
        olmId?: string;
        version?: string | null;
    }[]
) {
    if (entries.length === 0) {
        return;
    }

    const resolvedTargets = await resolveOlmTargets(entries);

    if (resolvedTargets.length === 0) {
        return;
    }

    const payloads = entries
        .map((entry) => {
            const resolved = resolvedTargets.find(
                (target) => target.clientId === entry.clientId
            );
            if (!resolved) {
                return null;
            }

            return {
                clientId: resolved.olmId,
                message: {
                    type: `olm/wg/peer/data/add`,
                    data: {
                        siteId: entry.siteId,
                        remoteSubnets: entry.remoteSubnets,
                        aliases: entry.aliases
                    }
                },
                options: {
                    incrementConfigVersion: true,
                    compress: canCompress(resolved.version, "olm")
                }
            };
        })
        .filter((entry) => entry !== null);

    if (payloads.length === 0) {
        return;
    }

    await sendToClientsBatch(payloads);
}

export async function removePeerDataBatch(
    entries: {
        clientId: number;
        siteId: number;
        remoteSubnets: string[];
        aliases: Alias[];
        olmId?: string;
        version?: string | null;
    }[]
) {
    if (entries.length === 0) {
        return;
    }

    const resolvedTargets = await resolveOlmTargets(entries);

    if (resolvedTargets.length === 0) {
        return;
    }

    const payloads = entries
        .map((entry) => {
            const resolved = resolvedTargets.find(
                (target) => target.clientId === entry.clientId
            );
            if (!resolved) {
                return null;
            }

            return {
                clientId: resolved.olmId,
                message: {
                    type: `olm/wg/peer/data/remove`,
                    data: {
                        siteId: entry.siteId,
                        remoteSubnets: entry.remoteSubnets,
                        aliases: entry.aliases
                    }
                },
                options: {
                    incrementConfigVersion: true,
                    compress: canCompress(resolved.version, "olm")
                }
            };
        })
        .filter((entry) => entry !== null);

    if (payloads.length === 0) {
        return;
    }

    await sendToClientsBatch(payloads);
}

export async function updatePeerDataBatch(
    entries: {
        clientId: number;
        siteId: number;
        remoteSubnets:
            | {
                  oldRemoteSubnets: string[];
                  newRemoteSubnets: string[];
              }
            | undefined;
        aliases:
            | {
                  oldAliases: Alias[];
                  newAliases: Alias[];
              }
            | undefined;
        olmId?: string;
        version?: string | null;
    }[]
) {
    if (entries.length === 0) {
        return;
    }

    const resolvedTargets = await resolveOlmTargets(entries);

    if (resolvedTargets.length === 0) {
        return;
    }

    const payloads = entries
        .map((entry) => {
            const resolved = resolvedTargets.find(
                (target) => target.clientId === entry.clientId
            );
            if (!resolved) {
                return null;
            }

            return {
                clientId: resolved.olmId,
                message: {
                    type: `olm/wg/peer/data/update`,
                    data: {
                        siteId: entry.siteId,
                        ...entry.remoteSubnets,
                        ...entry.aliases
                    }
                },
                options: {
                    incrementConfigVersion: true,
                    compress: canCompress(resolved.version, "olm")
                }
            };
        })
        .filter((entry) => entry !== null);

    if (payloads.length === 0) {
        return;
    }

    await sendToClientsBatch(payloads);
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
