import { db, primaryDb, sites, targetHealthCheck, targets } from "@server/db";
import logger from "@server/logger";
import { and, eq, inArray } from "drizzle-orm";
import {
    fireHealthCheckHealthyAlert,
    fireHealthCheckUnhealthyAlert
} from "#dynamic/lib/alerts";
import * as net from "net";

// Local healthcheck pollers run server-side for sites of type "local",
// because there is no Newt agent on the remote side to perform the probes.
// We re-use the targetHealthCheck table and the same alert helpers used by
// the Newt-driven flow so the rest of the system (UI, alerts, history) is
// unchanged.

const LOCAL_HC_TICK_MS = 5 * 1000; // re-evaluate which checks are due every 5s
const DEFAULT_INTERVAL_S = 30;
const DEFAULT_TIMEOUT_S = 5;

let localHealthCheckerInterval: NodeJS.Timeout | null = null;

// In-memory state for each local healthcheck so we can implement
// healthy / unhealthy thresholds and per-check intervals without hammering
// the database with extra columns.
type RunState = {
    nextRunAtMs: number;
    consecutiveHealthy: number;
    consecutiveUnhealthy: number;
    lastStatus: "unknown" | "healthy" | "unhealthy";
    inFlight: boolean;
};

const runState = new Map<number, RunState>();

function parseHcHeaders(raw: string | null | undefined): Record<string, string> {
    if (!raw) return {};
    try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
            const out: Record<string, string> = {};
            for (const h of parsed) {
                if (h && typeof h.name === "string") {
                    out[h.name] = String(h.value ?? "");
                }
            }
            return out;
        }
        if (parsed && typeof parsed === "object") {
            return parsed as Record<string, string>;
        }
    } catch (e) {
        logger.warn(
            `Failed to parse healthcheck headers, ignoring: ${(e as Error).message}`
        );
    }
    return {};
}

async function probeHttp(
    hc: typeof targetHealthCheck.$inferSelect,
    hostname: string,
    port: number
): Promise<{ ok: boolean; error?: string }> {
    const scheme =
        (hc.hcScheme || "http").toLowerCase() === "https" ? "https" : "http";
    const path = hc.hcPath?.startsWith("/") ? hc.hcPath : `/${hc.hcPath || ""}`;
    const url = `${scheme}://${hostname}:${port}${path}`;
    const method = (hc.hcMethod || "GET").toUpperCase();
    const timeoutMs = (hc.hcTimeout || DEFAULT_TIMEOUT_S) * 1000;
    const headers = parseHcHeaders(hc.hcHeaders);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        // Allow self-signed certs via undici's built-in by relying on
        // NODE_TLS_REJECT_UNAUTHORIZED if the operator sets it; otherwise
        // honour the system trust store. For TLS server name we fall back
        // to the URL hostname.
        const res = await fetch(url, {
            method,
            headers,
            redirect: hc.hcFollowRedirects === false ? "manual" : "follow",
            signal: controller.signal
        });

        const expected = hc.hcStatus;
        if (expected != null) {
            if (res.status === expected) return { ok: true };
            return {
                ok: false,
                error: `unexpected status ${res.status}, expected ${expected}`
            };
        }
        // Default: any 2xx is healthy
        if (res.status >= 200 && res.status < 300) return { ok: true };
        return { ok: false, error: `non-2xx status ${res.status}` };
    } catch (err) {
        const msg =
            err instanceof Error
                ? err.name === "AbortError"
                    ? `timeout after ${timeoutMs}ms`
                    : err.message
                : String(err);
        return { ok: false, error: msg };
    } finally {
        clearTimeout(timer);
    }
}

async function probeTcp(
    hostname: string,
    port: number,
    timeoutS: number
): Promise<{ ok: boolean; error?: string }> {
    const timeoutMs = (timeoutS || DEFAULT_TIMEOUT_S) * 1000;
    return new Promise((resolve) => {
        const socket = new net.Socket();
        let settled = false;
        const finish = (ok: boolean, error?: string) => {
            if (settled) return;
            settled = true;
            try {
                socket.destroy();
            } catch {}
            resolve({ ok, error });
        };
        socket.setTimeout(timeoutMs);
        socket.once("connect", () => finish(true));
        socket.once("timeout", () => finish(false, `timeout after ${timeoutMs}ms`));
        socket.once("error", (err) => finish(false, err.message));
        try {
            socket.connect(port, hostname);
        } catch (err) {
            finish(false, (err as Error).message);
        }
    });
}

async function runOneCheck(
    hc: typeof targetHealthCheck.$inferSelect & { targetIp: string | null; targetPort: number | null }
): Promise<void> {
    const state = runState.get(hc.targetHealthCheckId)!;
    if (state.inFlight) return;
    state.inFlight = true;

    try {
        // Resolve hostname/port: explicit hc fields win, otherwise fall back
        // to the target's ip/port so users don't have to duplicate them.
        const hostname = hc.hcHostname || hc.targetIp;
        const port = hc.hcPort || hc.targetPort;
        const mode = (hc.hcMode || "http").toLowerCase();

        if (!hostname || !port) {
            logger.debug(
                `Local healthcheck ${hc.targetHealthCheckId} missing hostname/port, skipping`
            );
            scheduleNext(hc, state, /*healthy*/ false);
            return;
        }

        const result =
            mode === "tcp"
                ? await probeTcp(hostname, port, hc.hcTimeout || DEFAULT_TIMEOUT_S)
                : await probeHttp(hc, hostname, port);

        const healthyThreshold = Math.max(1, hc.hcHealthyThreshold || 1);
        const unhealthyThreshold = Math.max(1, hc.hcUnhealthyThreshold || 1);

        if (result.ok) {
            state.consecutiveHealthy++;
            state.consecutiveUnhealthy = 0;
        } else {
            state.consecutiveUnhealthy++;
            state.consecutiveHealthy = 0;
            logger.debug(
                `Local healthcheck ${hc.targetHealthCheckId} probe failed: ${result.error}`
            );
        }

        let nextStatus: "healthy" | "unhealthy" | null = null;
        if (state.consecutiveHealthy >= healthyThreshold) {
            nextStatus = "healthy";
        } else if (state.consecutiveUnhealthy >= unhealthyThreshold) {
            nextStatus = "unhealthy";
        }

        if (nextStatus && nextStatus !== state.lastStatus) {
            await applyStatusChange(hc, nextStatus);
            state.lastStatus = nextStatus;
        }

        scheduleNext(hc, state, result.ok);
    } catch (err) {
        logger.error(
            `Local healthcheck ${hc.targetHealthCheckId} unexpected error`,
            { error: err }
        );
        scheduleNext(hc, state, false);
    } finally {
        state.inFlight = false;
    }
}

function scheduleNext(
    hc: typeof targetHealthCheck.$inferSelect,
    state: RunState,
    healthy: boolean
) {
    const interval = healthy
        ? hc.hcInterval || DEFAULT_INTERVAL_S
        : hc.hcUnhealthyInterval || hc.hcInterval || DEFAULT_INTERVAL_S;
    state.nextRunAtMs = Date.now() + interval * 1000;
}

async function applyStatusChange(
    hc: typeof targetHealthCheck.$inferSelect,
    nextStatus: "healthy" | "unhealthy"
) {
    await db.transaction(async (trx: any) => {
        await trx
            .update(targetHealthCheck)
            .set({ hcHealth: nextStatus })
            .where(
                eq(
                    targetHealthCheck.targetHealthCheckId,
                    hc.targetHealthCheckId
                )
            );

        if (nextStatus === "unhealthy") {
            await fireHealthCheckUnhealthyAlert(
                hc.orgId,
                hc.targetHealthCheckId,
                hc.name ?? undefined,
                hc.targetId,
                undefined,
                true,
                trx
            );
        } else {
            await fireHealthCheckHealthyAlert(
                hc.orgId,
                hc.targetHealthCheckId,
                hc.name ?? undefined,
                hc.targetId,
                undefined,
                true,
                trx
            );
        }
    });

    logger.debug(
        `Local healthcheck ${hc.targetHealthCheckId} transitioned to ${nextStatus}`
    );
}

async function tick() {
    try {
        // Pull the active set of healthchecks bound to local sites. We use
        // primaryDb so freshly-edited checks are picked up on the next tick.
        const rows = await primaryDb
            .select({
                targetHealthCheckId: targetHealthCheck.targetHealthCheckId,
                targetId: targetHealthCheck.targetId,
                orgId: targetHealthCheck.orgId,
                siteId: targetHealthCheck.siteId,
                name: targetHealthCheck.name,
                hcEnabled: targetHealthCheck.hcEnabled,
                hcPath: targetHealthCheck.hcPath,
                hcScheme: targetHealthCheck.hcScheme,
                hcMode: targetHealthCheck.hcMode,
                hcHostname: targetHealthCheck.hcHostname,
                hcPort: targetHealthCheck.hcPort,
                hcInterval: targetHealthCheck.hcInterval,
                hcUnhealthyInterval: targetHealthCheck.hcUnhealthyInterval,
                hcTimeout: targetHealthCheck.hcTimeout,
                hcHeaders: targetHealthCheck.hcHeaders,
                hcFollowRedirects: targetHealthCheck.hcFollowRedirects,
                hcMethod: targetHealthCheck.hcMethod,
                hcStatus: targetHealthCheck.hcStatus,
                hcHealth: targetHealthCheck.hcHealth,
                hcTlsServerName: targetHealthCheck.hcTlsServerName,
                hcHealthyThreshold: targetHealthCheck.hcHealthyThreshold,
                hcUnhealthyThreshold: targetHealthCheck.hcUnhealthyThreshold,
                targetIp: targets.ip,
                targetPort: targets.port,
                siteType: sites.type
            })
            .from(targetHealthCheck)
            .innerJoin(sites, eq(sites.siteId, targetHealthCheck.siteId))
            .leftJoin(
                targets,
                eq(targets.targetId, targetHealthCheck.targetId)
            )
            .where(
                and(
                    eq(sites.type, "local"),
                    eq(targetHealthCheck.hcEnabled, true)
                )
            );

        // Garbage-collect state for checks that no longer exist or were disabled.
        const live = new Set(rows.map((r: { targetHealthCheckId: number }) => r.targetHealthCheckId));
        for (const id of runState.keys()) {
            if (!live.has(id)) runState.delete(id);
        }

        const now = Date.now();
        for (const hc of rows) {
            let state = runState.get(hc.targetHealthCheckId);
            if (!state) {
                state = {
                    nextRunAtMs: 0, // run immediately on first observation
                    consecutiveHealthy: 0,
                    consecutiveUnhealthy: 0,
                    lastStatus:
                        (hc.hcHealth as "unknown" | "healthy" | "unhealthy") ||
                        "unknown",
                    inFlight: false
                };
                runState.set(hc.targetHealthCheckId, state);
            }

            if (state.inFlight) continue;
            if (state.nextRunAtMs > now) continue;

            // Fire and forget; runOneCheck guards against overlap via inFlight.
            void runOneCheck(hc as any);
        }
    } catch (err) {
        logger.error("Error in local healthcheck tick", { error: err });
    }
}

export const startLocalHealthChecker = (): void => {
    if (localHealthCheckerInterval) return;
    localHealthCheckerInterval = setInterval(tick, LOCAL_HC_TICK_MS);
    logger.debug("Started local healthcheck poller");
};

export const stopLocalHealthChecker = (): void => {
    if (localHealthCheckerInterval) {
        clearInterval(localHealthCheckerInterval);
        localHealthCheckerInterval = null;
        runState.clear();
        logger.info("Stopped local healthcheck poller");
    }
};
