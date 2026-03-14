import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

const blockedIpv4Cidrs = [
    ["0.0.0.0", 8],
    ["10.0.0.0", 8],
    ["100.64.0.0", 10],
    ["127.0.0.0", 8],
    ["169.254.0.0", 16],
    ["172.16.0.0", 12],
    ["192.0.0.0", 24],
    ["192.0.2.0", 24],
    ["192.88.99.0", 24],
    ["192.168.0.0", 16],
    ["198.18.0.0", 15],
    ["198.51.100.0", 24],
    ["203.0.113.0", 24],
    ["224.0.0.0", 4],
    ["240.0.0.0", 4]
] as const;

function normalizeHostname(hostname: string): string {
    const lower = hostname.trim().toLowerCase();

    return lower.endsWith(".") ? lower.slice(0, -1) : lower;
}

function parseIpv4Address(address: string): number | null {
    const parts = address.split(".");
    if (parts.length !== 4) {
        return null;
    }

    let value = 0;

    for (const part of parts) {
        if (!/^\d+$/.test(part)) {
            return null;
        }

        const octet = Number(part);
        if (!Number.isInteger(octet) || octet < 0 || octet > 255) {
            return null;
        }

        value = (value << 8) + octet;
    }

    return value >>> 0;
}

function isIpv4InCidr(
    address: string,
    network: string,
    prefix: number
): boolean {
    const parsedAddress = parseIpv4Address(address);
    const parsedNetwork = parseIpv4Address(network);

    if (parsedAddress === null || parsedNetwork === null) {
        return false;
    }

    const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;

    return (parsedAddress & mask) === (parsedNetwork & mask);
}

function normalizeIpv6Input(address: string): string {
    const zoneIndex = address.indexOf("%");

    return zoneIndex === -1
        ? address.toLowerCase()
        : address.slice(0, zoneIndex).toLowerCase();
}

function expandIpv6Address(address: string): string[] | null {
    const normalized = normalizeIpv6Input(address);

    let prepared = normalized;
    if (prepared.includes(".")) {
        const lastColonIndex = prepared.lastIndexOf(":");
        if (lastColonIndex === -1) {
            return null;
        }

        const ipv4Tail = prepared.slice(lastColonIndex + 1);
        const parsedIpv4 = parseIpv4Address(ipv4Tail);
        if (parsedIpv4 === null) {
            return null;
        }

        const high = ((parsedIpv4 >>> 16) & 0xffff).toString(16);
        const low = (parsedIpv4 & 0xffff).toString(16);

        prepared = `${prepared.slice(0, lastColonIndex)}:${high}:${low}`;
    }

    const sections = prepared.split("::");
    if (sections.length > 2) {
        return null;
    }

    const [leftSection, rightSection = ""] = sections;

    const leftGroups = leftSection === "" ? [] : leftSection.split(":");
    const rightGroups = rightSection === "" ? [] : rightSection.split(":");

    const allGroups = [...leftGroups, ...rightGroups];
    const hasInvalidGroup = allGroups.some(
        (group) => group === "" || !/^[\da-f]{1,4}$/i.test(group)
    );
    if (hasInvalidGroup) {
        return null;
    }

    if (sections.length === 1) {
        if (allGroups.length !== 8) {
            return null;
        }

        return allGroups.map((group) => group.padStart(4, "0"));
    }

    const missingGroups = 8 - (leftGroups.length + rightGroups.length);
    if (missingGroups < 1) {
        return null;
    }

    return [
        ...leftGroups.map((group) => group.padStart(4, "0")),
        ...Array.from({ length: missingGroups }, () => "0000"),
        ...rightGroups.map((group) => group.padStart(4, "0"))
    ];
}

function isDisallowedIpv4Address(address: string): boolean {
    return blockedIpv4Cidrs.some(([network, prefix]) =>
        isIpv4InCidr(address, network, prefix)
    );
}

function isDisallowedIpv6Address(address: string): boolean {
    const groups = expandIpv6Address(address);
    if (!groups) {
        return true;
    }

    const [group0, group1, group2, group3, group4, group5, group6, group7] =
        groups;

    const first = parseInt(group0, 16);
    const second = parseInt(group1, 16);
    const third = parseInt(group2, 16);
    const fourth = parseInt(group3, 16);
    const fifth = parseInt(group4, 16);
    const sixth = parseInt(group5, 16);
    const seventh = parseInt(group6, 16);
    const eighth = parseInt(group7, 16);

    const isUnspecified =
        first === 0 &&
        second === 0 &&
        third === 0 &&
        fourth === 0 &&
        fifth === 0 &&
        sixth === 0 &&
        seventh === 0 &&
        eighth === 0;
    if (isUnspecified) {
        return true;
    }

    const isLoopback =
        first === 0 &&
        second === 0 &&
        third === 0 &&
        fourth === 0 &&
        fifth === 0 &&
        sixth === 0 &&
        seventh === 0 &&
        eighth === 1;
    if (isLoopback) {
        return true;
    }

    if ((first & 0xfe00) === 0xfc00) {
        return true;
    }

    if ((first & 0xffc0) === 0xfe80) {
        return true;
    }

    if ((first & 0xff00) === 0xff00) {
        return true;
    }

    const isDocumentation = first === 0x2001 && second === 0x0db8;
    if (isDocumentation) {
        return true;
    }

    const isBenchmarking =
        first === 0x2001 && second === 0x0002 && third === 0x0000;
    if (isBenchmarking) {
        return true;
    }

    const isDiscardOnly =
        first === 0x0100 &&
        second === 0x0000 &&
        third === 0x0000 &&
        fourth === 0x0000;
    if (isDiscardOnly) {
        return true;
    }

    const isIpv4Mapped =
        first === 0 &&
        second === 0 &&
        third === 0 &&
        fourth === 0 &&
        fifth === 0 &&
        sixth === 0xffff;
    if (isIpv4Mapped) {
        const mappedIpv4 = `${seventh >>> 8}.${seventh & 0xff}.${eighth >>> 8}.${eighth & 0xff}`;

        return isDisallowedIpv4Address(mappedIpv4);
    }

    return false;
}

function isDisallowedIpAddress(address: string): boolean {
    const family = isIP(address);

    if (family === 4) {
        return isDisallowedIpv4Address(address);
    }

    if (family === 6) {
        return isDisallowedIpv6Address(address);
    }

    return true;
}

function validateBackchannelLogoutUrlShape(url: URL): string | null {
    if (url.protocol !== "https:") {
        return "backchannelLogoutUri must use https";
    }

    if (url.username || url.password) {
        return "backchannelLogoutUri must not include credentials";
    }

    const hostname = normalizeHostname(url.hostname);

    if (hostname === "localhost" || hostname.endsWith(".localhost")) {
        return "backchannelLogoutUri must not target localhost";
    }

    if (hostname.endsWith(".local")) {
        return "backchannelLogoutUri must not target local-only hostnames";
    }

    if (isIP(hostname) !== 0 && isDisallowedIpAddress(hostname)) {
        return "backchannelLogoutUri must not target a private or reserved IP address";
    }

    return null;
}

function parseBackchannelLogoutUrl(uri: string): URL {
    return new URL(uri);
}

export function validateBackchannelLogoutUri(uri: string): string | null {
    let url: URL;

    try {
        url = parseBackchannelLogoutUrl(uri);
    } catch {
        return "backchannelLogoutUri must be a valid URL";
    }

    return validateBackchannelLogoutUrlShape(url);
}

export async function assertBackchannelLogoutDestinationAllowed(
    uri: string
): Promise<URL> {
    const shapeError = validateBackchannelLogoutUri(uri);
    if (shapeError) {
        throw new Error(shapeError);
    }

    const url = parseBackchannelLogoutUrl(uri);
    const hostname = normalizeHostname(url.hostname);

    if (isIP(hostname) !== 0) {
        return url;
    }

    const resolvedAddresses = await lookup(hostname, {
        all: true,
        verbatim: true
    });

    if (resolvedAddresses.length === 0) {
        throw new Error(
            "backchannelLogoutUri did not resolve to any destination address"
        );
    }

    const blockedAddress = resolvedAddresses.find((record) =>
        isDisallowedIpAddress(record.address)
    );

    if (blockedAddress) {
        throw new Error(
            "backchannelLogoutUri resolves to a private or reserved IP address"
        );
    }

    return url;
}
