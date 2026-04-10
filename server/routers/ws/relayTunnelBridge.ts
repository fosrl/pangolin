import net, { Socket as NetSocket } from "net";
import { Socket } from "net";
import { URL } from "url";
import { WebSocket, WebSocketServer } from "ws";
import logger from "@server/logger";
import { validateOlmSessionToken } from "@server/auth/sessions/olm";
import { validateSessionToken } from "@server/auth/sessions/app";
import { clients, clientSitesAssociationsCache, db, exitNodes, olms, sites } from "@server/db";
import { eq, inArray } from "drizzle-orm";
import { WebSocketRequest } from "./types";
import config from "@server/lib/config";

const relayTunnelWss = new WebSocketServer({ noServer: true });

function resolveGerbilHost(reachableAt: string): string | null {
    try {
        if (reachableAt.startsWith("http://") || reachableAt.startsWith("https://")) {
            const url = new URL(reachableAt);
            return url.hostname;
        }

        const [host] = reachableAt.split(":");
        return host || null;
    } catch (error) {
        logger.error("Failed to resolve gerbil host from reachableAt %s: %o", reachableAt, error);
        return null;
    }
}

function writeFramedPacket(socket: NetSocket, payload: Buffer): void {
    const header = Buffer.allocUnsafe(4);
    header.writeUInt32BE(payload.length, 0);
    socket.write(header);
    socket.write(payload);
}

type FrameReaderState = {
    buffer: Buffer;
};

type RelayRegistrationPayload = {
    type: "relay-register";
    olmId: string;
    token: string;
    publicKey: string;
    reachableAt: string;
    exitNodePublicKey: string;
};

function consumeFramedPackets(
    state: FrameReaderState,
    chunk: Buffer,
    onPacket: (packet: Buffer) => void
) {
    state.buffer = Buffer.concat([state.buffer, chunk]);
    while (state.buffer.length >= 4) {
        const frameLen = state.buffer.readUInt32BE(0);
        if (frameLen <= 0 || frameLen > 64 * 1024) {
            throw new Error(`invalid frame length ${frameLen}`);
        }
        if (state.buffer.length < frameLen + 4) {
            return;
        }
        const packet = state.buffer.subarray(4, 4 + frameLen);
        state.buffer = state.buffer.subarray(4 + frameLen);
        onPacket(packet);
    }
}

async function resolveGerbilConnectionTarget(olmId: string): Promise<{
    host: string;
    port: number;
    clientPublicKey: string;
    reachableAt: string;
    exitNodePublicKey: string;
} | null> {
    const [olm] = await db.select().from(olms).where(eq(olms.olmId, olmId)).limit(1);
    if (!olm?.clientId) {
        logger.warn("Relay tunnel: olm %s has no client association", olmId);
        return null;
    }

    const [client] = await db.select().from(clients).where(eq(clients.clientId, olm.clientId)).limit(1);
    if (!client) {
        logger.warn("Relay tunnel: client not found for olm %s", olmId);
        return null;
    }

    const siteRows = await db
        .select({
            exitNodeId: sites.exitNodeId
        })
        .from(clientSitesAssociationsCache)
        .innerJoin(sites, eq(sites.siteId, clientSitesAssociationsCache.siteId))
        .where(eq(clientSitesAssociationsCache.clientId, client.clientId));

    const exitNodeIds = Array.from(
        new Set(siteRows.map((row) => row.exitNodeId).filter((id): id is number => id !== null))
    );

    if (exitNodeIds.length === 0) {
        logger.warn("Relay tunnel: no exit nodes for olm %s", olmId);
        return null;
    }

    const [exitNode] = await db
        .select()
        .from(exitNodes)
        .where(inArray(exitNodes.exitNodeId, exitNodeIds))
        .limit(1);

    if (!exitNode?.reachableAt) {
        logger.warn("Relay tunnel: exit node reachableAt missing for olm %s", olmId);
        return null;
    }

    const host = resolveGerbilHost(exitNode.reachableAt);
    if (!host) {
        return null;
    }

    return {
        host,
        port:
            config.getRawConfig().gerbil.wss_relay_port ||
            config.getRawConfig().gerbil.wss_relay_port,
        clientPublicKey: client.pubKey || "",
        reachableAt: exitNode.reachableAt,
        exitNodePublicKey: exitNode.publicKey || ""
    };
}

function sendRelayRegistration(socket: NetSocket, payload: RelayRegistrationPayload): void {
    const registrationData = Buffer.from(JSON.stringify(payload));
    writeFramedPacket(socket, registrationData);
}

async function setupRelayTunnel(
    ws: WebSocket,
    olmId: string,
    token: string
): Promise<void> {
    const target = await resolveGerbilConnectionTarget(olmId);
    if (!target) {
        ws.close(1011, "No relay target");
        return;
    }

    const gerbilSocket = net.createConnection({
        host: target.host,
        port: target.port
    });
    const pendingFrames: Buffer[] = [];
    let relayReady = false;
    const maxPendingFrames = 256;

    gerbilSocket.on("connect", () => {
        logger.info("Relay tunnel WebSocket connected for OLM %s", olmId);
        try {
            sendRelayRegistration(gerbilSocket, {
                type: "relay-register",
                olmId,
                token,
                publicKey: target.clientPublicKey,
                reachableAt: target.reachableAt,
                exitNodePublicKey: target.exitNodePublicKey
            });
            relayReady = true;
            logger.debug("Relay tunnel registration sent for OLM %s", olmId);
            while (pendingFrames.length > 0) {
                const queuedPayload = pendingFrames.shift();
                if (!queuedPayload) {
                    break;
                }
                writeFramedPacket(gerbilSocket, queuedPayload);
            }
        } catch (error) {
            logger.warn("Relay tunnel registration failed for OLM %s: %o", olmId, error);
            if (ws.readyState === WebSocket.OPEN) {
                ws.close(1011, "Relay registration failed");
            }
            gerbilSocket.destroy();
        }
    });

    const readerState: FrameReaderState = { buffer: Buffer.alloc(0) };

    gerbilSocket.on("data", (chunk: Buffer) => {
        try {
            consumeFramedPackets(readerState, chunk, (packet) => {
                if (ws.readyState === WebSocket.OPEN) {
                    ws.send(packet, { binary: true });
                }
            });
        } catch (error) {
            logger.warn("Relay tunnel decode error for OLM %s: %o", olmId, error);
            ws.close(1011, "Relay decode error");
            gerbilSocket.destroy();
        }
    });

    gerbilSocket.on("error", (error) => {
        logger.warn("Relay tunnel gerbil socket error for OLM %s: %o", olmId, error);
        if (ws.readyState === WebSocket.OPEN) {
            ws.close(1011, "Relay socket error");
        }
    });

    gerbilSocket.on("close", () => {
        if (ws.readyState === WebSocket.OPEN) {
            ws.close(1000, "Relay closed");
        }
    });

    ws.on("message", (data, isBinary) => {
        if (!isBinary) {
            logger.debug("Relay tunnel dropped non-binary message for OLM %s", olmId);
            return;
        }

        const payload = Buffer.isBuffer(data) ? data : Buffer.from(data as ArrayBuffer);
        if (!relayReady) {
            if (pendingFrames.length >= maxPendingFrames) {
                logger.warn(
                    "Relay tunnel pending frame buffer full for OLM %s, closing tunnel",
                    olmId
                );
                ws.close(1013, "Relay not ready");
                gerbilSocket.destroy();
                return;
            }
            pendingFrames.push(payload);
            logger.debug(
                "Relay tunnel queued %d-byte frame for OLM %s (pending=%d)",
                payload.length,
                olmId,
                pendingFrames.length
            );
            return;
        }

        logger.debug("Relay tunnel: forwarding %d bytes to Gerbil for OLM %s", payload.length, olmId);
        writeFramedPacket(gerbilSocket, payload);
    });

    ws.on("close", () => {
        pendingFrames.length = 0;
        gerbilSocket.destroy();
        logger.info("Relay tunnel WebSocket closed for OLM %s", olmId);
    });

    ws.on("error", (error) => {
        logger.warn("Relay tunnel WebSocket error for OLM %s: %o", olmId, error);
        gerbilSocket.destroy();
    });
}

async function verifyRelayToken(token: string, userToken: string): Promise<string | null> {
    const { session, olm } = await validateOlmSessionToken(token);
    if (!session || !olm) {
        return null;
    }

    if (olm.userId) {
        const { session: userSession, user } = await validateSessionToken(userToken);
        if (!userSession || !user || user.userId !== olm.userId) {
            return null;
        }
    }

    return olm.olmId;
}

export const handleRelayTunnelUpgrade = async (
    request: WebSocketRequest,
    socket: Socket,
    head: Buffer
): Promise<boolean> => {
    const requestUrl = new URL(request.url || "", `http://${request.headers.host}`);
    const pathname = requestUrl.pathname;

    if (!pathname.endsWith("/relay-tunnel")) {
        return false;
    }

    logger.debug("Relay tunnel upgrade requested: %s", request.url);

    const token =
        requestUrl.searchParams.get("token") ||
        (request.headers["sec-websocket-protocol"] as string) ||
        "";
    const userToken = requestUrl.searchParams.get("userToken") || "";

    if (!token) {
        logger.warn("Relay tunnel upgrade rejected: missing token");
        socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
        socket.destroy();
        return true;
    }

    const olmId = await verifyRelayToken(token, userToken);
    if (!olmId) {
        logger.warn("Relay tunnel upgrade rejected: invalid olm session token");
        socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
        socket.destroy();
        return true;
    }

    relayTunnelWss.handleUpgrade(request, socket, head, (ws) => {
        void setupRelayTunnel(ws, olmId, token);
    });

    return true;
};
