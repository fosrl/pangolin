import type { Request } from "express";
import { getCountryCodeForIp } from "@server/lib/geoip";
import { getAsnForIp } from "@server/lib/asn";

// Details about the client that created a session, shown to admins when
// reviewing active sessions. Country and ASN are looked up from the IP when
// not provided.
export type SessionClientInfo = {
    ip?: string | null;
    userAgent?: string | null;
    countryCode?: string | null;
    asn?: number | null;
};

const MAX_USER_AGENT_LENGTH = 1024;

export function getRequestClientInfo(req: Request): SessionClientInfo {
    return {
        ip: req.ip,
        userAgent: req.headers["user-agent"]
    };
}

export async function resolveClientInfo(
    info: SessionClientInfo | undefined
): Promise<Required<SessionClientInfo>> {
    const ip = info?.ip || null;
    const userAgent = info?.userAgent
        ? info.userAgent.slice(0, MAX_USER_AGENT_LENGTH)
        : null;

    let countryCode = info?.countryCode ?? null;
    let asn = info?.asn ?? null;
    if (ip) {
        if (info?.countryCode === undefined) {
            countryCode = (await getCountryCodeForIp(ip)) ?? null;
        }
        if (info?.asn === undefined) {
            asn = (await getAsnForIp(ip)) ?? null;
        }
    }

    return { ip, userAgent, countryCode, asn };
}
