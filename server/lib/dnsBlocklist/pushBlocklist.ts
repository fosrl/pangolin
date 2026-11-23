import {
    db,
    Olm,
    olms,
    clients,
    userOrgRoles,
    clientOrgRoles,
    roleDnsBlocking
} from "@server/db";
import { and, eq, inArray } from "drizzle-orm";
import logger from "@server/logger";
import { sendToClient } from "#dynamic/routers/ws";
import cache from "#dynamic/lib/cache";
import { supportsDnsBlocklist } from "@server/lib/clientVersionChecks";
import { EMPTY_BLOCKLIST, resolveBlocklistForOlm } from "./resolve";

// What each olm last received, so a push that would not change a device's list
// is not sent. Kept in the shared cache so any node can tell. An olm that has
// no entry (expired, or never sent) always gets the push, which is harmless.
const SENT_VERSION_TTL_SECONDS = 7 * 24 * 60 * 60;
const sentVersionKey = (olmId: string) => `olm:dnsBlocklist:version:${olmId}`;

// Bursts of changes (editing a list, adding several users to a role) are
// coalesced, and sends are limited in parallelism because a payload for a large
// list can be a few hundred KB.
const PUSH_DEBOUNCE_MS = 2000;
const PUSH_CONCURRENCY = 5;

async function sendBlocklist(
    olm: Olm,
    mode: "register" | "push"
): Promise<void> {
    if (!supportsDnsBlocklist(olm.version)) return;

    const resolved = await resolveBlocklistForOlm(olm);
    const key = sentVersionKey(olm.olmId);

    if (mode === "register") {
        // A fresh connection starts with no list. Nothing to send if there is
        // nothing to block, but record that so later pushes can tell.
        if (
            resolved === EMPTY_BLOCKLIST ||
            (!resolved.compressed && !resolved.pageCompressed)
        ) {
            await cache.set(key, "", SENT_VERSION_TTL_SECONDS);
            return;
        }
    } else {
        const last = await cache.get<string>(key);
        if (last !== undefined && last !== null && last === resolved.version) {
            return; // the device already has exactly this list
        }
    }

    const sent = await sendToClient(
        olm.olmId,
        {
            type: "olm/dns/blocklist",
            data: {
                version: resolved.version,
                // already compressed, so the websocket frame is not
                compressed: resolved.compressed,
                // only sent to olms that support the block page
                ...(resolved.pageCompressed
                    ? {
                          pageCompressed: resolved.pageCompressed,
                          pageUrl: resolved.pageUrl
                      }
                    : {}),
                logBlocks: resolved.logBlocks
            }
        },
        { compress: false }
    );

    if (sent) {
        await cache.set(key, resolved.version, SENT_VERSION_TTL_SECONDS);
    } else {
        // Not connected; it gets its list when it registers.
        await cache.del(key);
    }
}

/**
 * Sends an olm its blocklist right after it registers. Never throws, so it
 * cannot disturb the register flow.
 */
export async function sendDnsBlocklistToOlm(olm: Olm): Promise<void> {
    try {
        await sendBlocklist(olm, "register");
    } catch (error) {
        logger.error(
            `Failed to send DNS blocklist to olm ${olm.olmId}:`,
            error
        );
    }
}

// ---------------------------------------------------------------------------
// Pushing changes to connected olms
// ---------------------------------------------------------------------------

const pendingOlmIds = new Set<string>();
let flushTimer: NodeJS.Timeout | null = null;

function schedulePush(olmIds: string[]) {
    if (olmIds.length === 0) return;
    for (const id of olmIds) pendingOlmIds.add(id);
    if (flushTimer) return;

    flushTimer = setTimeout(() => {
        flushTimer = null;
        const ids = [...pendingOlmIds];
        pendingOlmIds.clear();
        processPushes(ids).catch((error) =>
            logger.error("Failed to push DNS blocklists:", error)
        );
    }, PUSH_DEBOUNCE_MS);
    flushTimer.unref();
}

async function processPushes(olmIds: string[]) {
    for (let i = 0; i < olmIds.length; i += PUSH_CONCURRENCY) {
        const chunk = olmIds.slice(i, i + PUSH_CONCURRENCY);
        const rows = await db
            .select()
            .from(olms)
            .where(inArray(olms.olmId, chunk));
        await Promise.all(
            rows.map(async (olm) => {
                try {
                    await sendBlocklist(olm, "push");
                } catch (error) {
                    logger.error(
                        `Failed to push DNS blocklist to olm ${olm.olmId}:`,
                        error
                    );
                }
            })
        );
    }
}

/** Pushes new lists to every olm whose user or client has one of these roles. */
export async function pushBlocklistForRoles(
    orgId: string,
    roleIds: number[]
): Promise<void> {
    try {
        if (roleIds.length === 0) return;

        // user devices: users holding the role, connected to this org
        const userDevices = await db
            .select({ olmId: olms.olmId })
            .from(userOrgRoles)
            .innerJoin(olms, eq(olms.userId, userOrgRoles.userId))
            .innerJoin(clients, eq(clients.clientId, olms.clientId))
            .where(
                and(
                    inArray(userOrgRoles.roleId, roleIds),
                    eq(userOrgRoles.orgId, orgId),
                    eq(clients.orgId, orgId)
                )
            );

        // machine devices: clients holding the role
        const machineDevices = await db
            .select({ olmId: olms.olmId })
            .from(clientOrgRoles)
            .innerJoin(olms, eq(olms.clientId, clientOrgRoles.clientId))
            .where(
                and(
                    inArray(clientOrgRoles.roleId, roleIds),
                    eq(clientOrgRoles.orgId, orgId)
                )
            );

        schedulePush([
            ...new Set([
                ...userDevices.map((r) => r.olmId),
                ...machineDevices.map((r) => r.olmId)
            ])
        ]);
    } catch (error) {
        logger.error("Failed to find olms for DNS blocklist push:", error);
    }
}

/** Pushes new lists to one user's devices in an org (their roles changed). */
export async function pushBlocklistForUser(
    orgId: string,
    userId: string
): Promise<void> {
    try {
        const devices = await db
            .select({ olmId: olms.olmId })
            .from(olms)
            .innerJoin(clients, eq(clients.clientId, olms.clientId))
            .where(and(eq(olms.userId, userId), eq(clients.orgId, orgId)));
        schedulePush(devices.map((r) => r.olmId));
    } catch (error) {
        logger.error("Failed to find olms for DNS blocklist push:", error);
    }
}

/** Pushes new lists to a machine client's device (its roles changed). */
export async function pushBlocklistForClient(clientId: number): Promise<void> {
    try {
        const devices = await db
            .select({ olmId: olms.olmId })
            .from(olms)
            .where(eq(olms.clientId, clientId));
        schedulePush(devices.map((r) => r.olmId));
    } catch (error) {
        logger.error("Failed to find olms for DNS blocklist push:", error);
    }
}

/** Pushes new lists to every device in an org. */
export async function pushBlocklistForOrg(orgId: string): Promise<void> {
    try {
        const devices = await db
            .select({ olmId: olms.olmId })
            .from(olms)
            .innerJoin(clients, eq(clients.clientId, olms.clientId))
            .where(eq(clients.orgId, orgId));
        schedulePush(devices.map((r) => r.olmId));
    } catch (error) {
        logger.error("Failed to find olms for DNS blocklist push:", error);
    }
}

/** Orgs that have at least one role with DNS blocking turned on. */
export async function getOrgIdsWithDnsBlocking(): Promise<string[]> {
    const rows = await db
        .selectDistinct({ orgId: roleDnsBlocking.orgId })
        .from(roleDnsBlocking)
        .where(eq(roleDnsBlocking.enabled, true));
    return rows.map((r) => r.orgId);
}
