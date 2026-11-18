/*
 * This file is part of a proprietary work.
 *
 * Copyright (c) 2025-2026 Fossorial, Inc.
 * All rights reserved.
 *
 * This file is licensed under the Fossorial Commercial License.
 * You may not use this file except in compliance with the License.
 * Unauthorized use, copying, modification, or distribution is strictly prohibited.
 *
 * This file is not licensed under the AGPLv3.
 */

// The contract between the standalone WebSocket gateway and the Pangolin
// servers behind it, spoken over the regional Redis. The gateway image bundles
// this file, so it must not import anything heavier than types.

// Device frames waiting to be handled. Consumed through a consumer group, so a
// frame survives every Pangolin being down and goes to one Pangolin only.
export const INBOUND_STREAM = "ws:gw:inbound";
// Connection authentication requests. Separate from the frames so a backlog of
// frames after an outage can't hold up devices that are trying to connect.
export const AUTH_STREAM = "ws:gw:auth";
// Everything going to the gateways. Each gateway reads the whole stream with
// its own cursor and keeps what it can deliver, so a gateway that loses Redis
// for a moment resumes where it left off.
export const OUTBOUND_STREAM = "ws:gw:outbound";

export const CONSUMER_GROUP = "pangolin";

// Which clients have a socket on a gateway in this region. The value is the
// connection id, so a socket that closes after its client reconnected
// elsewhere doesn't remove the newer connection's entry.
export const presenceKey = (clientId: string) => `ws:gw:presence:${clientId}`;

// Taken by the Pangolin that forwards a cross-region message, because every
// Pangolin in the region receives the pub/sub copy.
export const forwardClaimKey = (id: string) => `ws:gw:forward:${id}`;

export const FORWARD_CLAIM_TTL_SECONDS = 60;

// How often a gateway checks its sockets and reports the live ones. Must stay
// well under offline_checker.newt_threshold_ms, because this report is what
// keeps a connected site online.
export const LIVENESS_INTERVAL_MS = 15_000;
export const PRESENCE_TTL_SECONDS = 60;

// Roughly five minutes of traffic from tens of thousands of devices. This only
// limits how much Redis memory an outage can use. MAX_INBOUND_AGE_MS is what
// normally decides whether a frame is still worth handling.
export const INBOUND_STREAM_MAX_LENGTH = 500_000;
// A frame this old describes a state the device has moved on from
export const MAX_INBOUND_AGE_MS = 5 * 60 * 1000;
// Outbound entries only need to outlive a gateway losing its Redis connection
export const OUTBOUND_RETENTION_MS = 2 * 60 * 1000;

export const AUTH_TIMEOUT_MS = 10_000;
// Requests are removed as they're read, so this only matters while no Pangolin
// is running to read them
export const AUTH_STREAM_MAX_LENGTH = 100_000;

export type GatewayClientType = "newt" | "olm" | "remoteExitNode";

export const InboundKind = {
    // One frame from a device
    Message: "m",
    // Sites of every newt with a live socket on this gateway
    SiteLiveness: "s"
} as const;

export const OutboundKind = {
    Direct: "d",
    Broadcast: "b",
    Disconnect: "x",
    AuthResult: "a"
} as const;

export type InboundEntry =
    | {
          kind: typeof InboundKind.Message;
          clientId: string;
          clientType: GatewayClientType;
          timestamp: number;
          isBinary: boolean;
          data: Buffer;
      }
    | {
          kind: typeof InboundKind.SiteLiveness;
          siteIds: number[];
          timestamp: number;
      };

// The tokens are sent as the SHA-256 session ids Pangolin stores, so the long
// lived device credentials never sit in Redis
export interface AuthRequest {
    requestId: string;
    gatewayId: string;
    clientType: GatewayClientType;
    sessionId: string;
    userSessionId: string;
    timestamp: number;
}

export type AuthResult =
    { ok: true; clientId: string; siteId?: number | null } | { ok: false };

export type OutboundEntry =
    | {
          kind: typeof OutboundKind.Direct;
          clientId: string;
          isBinary: boolean;
          data: Buffer;
      }
    | {
          kind: typeof OutboundKind.Broadcast;
          excludeClientId: string;
          isBinary: boolean;
          data: Buffer;
      }
    | { kind: typeof OutboundKind.Disconnect; clientId: string }
    | {
          kind: typeof OutboundKind.AuthResult;
          gatewayId: string;
          requestId: string;
          result: AuthResult;
      };

// A stream entry is a flat list of field names and values, and every value
// here is text except the payload, which is the device's bytes untouched.
export type RawFields = (string | Buffer | number)[];

export function encodeMessageFields(
    clientId: string,
    clientType: GatewayClientType,
    timestamp: number,
    isBinary: boolean,
    data: Buffer
): RawFields {
    return [
        "k",
        InboundKind.Message,
        "c",
        clientId,
        "t",
        clientType,
        "ts",
        timestamp,
        "b",
        isBinary ? "1" : "0",
        "d",
        data
    ];
}

export function encodeSiteLivenessFields(
    siteIds: number[],
    timestamp: number
): RawFields {
    return [
        "k",
        InboundKind.SiteLiveness,
        "ts",
        timestamp,
        "d",
        JSON.stringify(siteIds)
    ];
}

export function encodeAuthRequestFields(request: AuthRequest): RawFields {
    return ["d", JSON.stringify(request)];
}

export function encodeDirectFields(
    clientId: string,
    isBinary: boolean,
    data: string | Buffer
): RawFields {
    return [
        "k",
        OutboundKind.Direct,
        "c",
        clientId,
        "b",
        isBinary ? "1" : "0",
        "d",
        data
    ];
}

export function encodeBroadcastFields(
    excludeClientId: string | undefined,
    isBinary: boolean,
    data: string | Buffer
): RawFields {
    return [
        "k",
        OutboundKind.Broadcast,
        "c",
        excludeClientId ?? "",
        "b",
        isBinary ? "1" : "0",
        "d",
        data
    ];
}

export function encodeDisconnectFields(clientId: string): RawFields {
    return ["k", OutboundKind.Disconnect, "c", clientId];
}

export function encodeAuthResultFields(
    gatewayId: string,
    requestId: string,
    result: AuthResult
): RawFields {
    return [
        "k",
        OutboundKind.AuthResult,
        "g",
        gatewayId,
        "r",
        requestId,
        "d",
        JSON.stringify(result)
    ];
}

function toFieldMap(fields: Buffer[]): Map<string, Buffer> {
    const map = new Map<string, Buffer>();
    for (let i = 0; i + 1 < fields.length; i += 2) {
        map.set(fields[i].toString(), fields[i + 1]);
    }
    return map;
}

function text(map: Map<string, Buffer>, field: string): string {
    return map.get(field)?.toString() ?? "";
}

export function decodeInbound(fields: Buffer[]): InboundEntry | null {
    const map = toFieldMap(fields);
    const kind = text(map, "k");
    const timestamp = Number(text(map, "ts"));
    if (kind === InboundKind.Message) {
        return {
            kind,
            clientId: text(map, "c"),
            clientType: text(map, "t") as GatewayClientType,
            timestamp,
            isBinary: text(map, "b") === "1",
            data: map.get("d") ?? Buffer.alloc(0)
        };
    }
    if (kind === InboundKind.SiteLiveness) {
        return { kind, siteIds: JSON.parse(text(map, "d")), timestamp };
    }
    return null;
}

export function decodeAuthRequest(fields: Buffer[]): AuthRequest {
    return JSON.parse(text(toFieldMap(fields), "d"));
}

export function decodeOutbound(fields: Buffer[]): OutboundEntry | null {
    const map = toFieldMap(fields);
    const kind = text(map, "k");
    if (kind === OutboundKind.Direct) {
        return {
            kind,
            clientId: text(map, "c"),
            isBinary: text(map, "b") === "1",
            data: map.get("d") ?? Buffer.alloc(0)
        };
    }
    if (kind === OutboundKind.Broadcast) {
        return {
            kind,
            excludeClientId: text(map, "c"),
            isBinary: text(map, "b") === "1",
            data: map.get("d") ?? Buffer.alloc(0)
        };
    }
    if (kind === OutboundKind.Disconnect) {
        return { kind, clientId: text(map, "c") };
    }
    if (kind === OutboundKind.AuthResult) {
        return {
            kind,
            gatewayId: text(map, "g"),
            requestId: text(map, "r"),
            result: JSON.parse(text(map, "d"))
        };
    }
    return null;
}
