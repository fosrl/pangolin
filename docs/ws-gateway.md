# WebSocket gateway

A standalone container (`Dockerfile.ws`) that holds the device WebSockets, so
that deploying Pangolin doesn't disconnect every newt, olm and remote exit node.
It has no database and no business logic. It authenticates nothing itself and
never parses a frame.

Without `flags.enable_ws_gateway`, nothing changes: Pangolin terminates sockets
itself, as self-hosted installs do.

## How it works

```
device ── wss ──> gateway ── ws:gw:inbound  ──> Pangolin (consumer group)
device <─ wss ─── gateway <─ ws:gw:outbound ─── Pangolin
                  gateway ── ws:gw:auth     ──> Pangolin
                       (regional Redis)            │
                                                   └─ main Redis pub/sub ─> other regions
```

All three are Redis streams on the **regional** Redis.

- **Inbound frames** go to `ws:gw:inbound`. Pangolin reads them through a
  consumer group, so each frame goes to one Pangolin, and acknowledges them only
  after the handler finishes. While every Pangolin is down, frames wait in the
  stream.
- **Crashes** are covered by claiming. A frame unacknowledged for 45 seconds
  belongs to a dead Pangolin and another one takes it. Live Pangolins keep
  refreshing the frames they're still handling, so a slow handler isn't run
  twice.
- **Outbound messages** go to `ws:gw:outbound`, which every gateway reads with
  its own cursor, keeping what it can deliver. Pangolin only appends if
  `ws:gw:presence:<clientId>` says the client is in this region. Otherwise the
  message goes over main Redis pub/sub as before, and in the region that has the
  client one Pangolin claims it and passes it on.
- **New connections** are authenticated by Pangolin, over `ws:gw:auth` so a
  backlog of frames can't delay them. The gateway sends the SHA-256 of the token
  (the session id), so device credentials aren't stored in Redis.
- **Liveness** is reported by the gateway every 15 seconds: it pings each
  socket, closes those that stopped answering, and reports the sites of the rest.
  This replaces `ws:connections` for newts on a gateway: an open socket keeps its
  site's `lastPing` current, so `hasActiveConnections` has nothing to add.

## Setup

Regional Redis, version 7 or later:

- `maxmemory-policy` must be `noeviction` or a `volatile-*` policy. Streams have
  no TTL, so an `allkeys-*` policy can evict the queue itself.
- Frames queued in Redis are only as durable as Redis is. Without persistence, a
  restart of the primary loses what was queued (and everything recovers on its
  own afterwards).

Pangolin, in `privateConfig.yml`:

```yaml
flags:
    enable_redis: true
    enable_ws_gateway: true
redis:
    # ...
    regional_redis:
        host: redis.pangolin.svc.cluster.local
        port: 6379
```

Gateway: mount the same `privateConfig.yml` at `/app/config`, or set
`REGIONAL_REDIS_HOST`, `REGIONAL_REDIS_PORT`, `REGIONAL_REDIS_PASSWORD` and
`REGIONAL_REDIS_DB`. It listens on `WS_GATEWAY_PORT` (default 3010), and serves
`GET /healthz` on the same port. Run as many as you like, with no stickiness.

Give it a termination grace period longer than `WS_GATEWAY_DRAIN_MS` (default
20 seconds), which is how long it spreads closing its sockets over on shutdown.

## Cutover

1. Deploy Pangolin with `flags.enable_ws_gateway`. It handles direct sockets and
   gateway frames side by side, so nothing has to switch at once.
2. Start the gateways.
3. Route `/api/v1/ws` to the gateways instead of Pangolin. Devices already
   connected to Pangolin stay there until its next restart, then reconnect
   through a gateway.

Keep the gateway image out of routine deploys. It only needs rebuilding when
`server/private/wsGateway` changes, and redeploying it does bounce its sockets.

`protocol.ts` is shared by both sides, so a change to it has to keep working
with gateways that are still running the old version.

## What is and isn't guaranteed

- A frame that reaches the gateway is handled **at least once**: a Pangolin that
  dies after finishing a handler but before acknowledging it means the frame
  runs again.
- Frames older than 5 minutes are dropped rather than handled, since by then the
  device has moved on. The stream is also capped at 500,000 entries.
- Frames from one device may be handled concurrently on different Pangolins.
  Handlers already interleave on a single Pangolin, but they used to at least
  start in order.
- Messages for a device with no open socket are **not** queued, same as before.
  A reconnecting device registers again and config version checks on its pings
  catch anything else.
- If the regional Redis is unreachable, the gateway buffers up to 512 MiB of
  frames and keeps sockets open, and Pangolin can't reach devices in the region.
- If no Pangolin answers within 10 seconds, new connections get a 503 and retry.
  Open sockets aren't affected.
- Frames are limited to 16 MiB, and to 600 per minute per socket at the gateway,
  on top of Pangolin's own rate limits.
- Olm pings carry the user's session token inside the frame, and the gateway
  can't hash what it doesn't read. Treat the regional Redis as holding
  credentials.

## Tests

`server/private/wsGateway/gateway.test.ts` runs the gateway and bridge against a
real Redis. The instructions are at the top of the file. Like other tests under
`server/private`, `npm test` doesn't pick it up.
