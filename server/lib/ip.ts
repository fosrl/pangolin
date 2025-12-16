import { db, SiteResource, siteResources, Transaction } from "@server/db";
import { clients, orgs, sites } from "@server/db";
import { and, eq, isNotNull } from "drizzle-orm";
import config from "@server/lib/config";
import z from "zod";
import logger from "@server/logger";

interface IPRange {
    start: bigint;
    end: bigint;
}

type IPVersion = 4 | 6;

/**
 * Detects IP version from address string
 */
function detectIpVersion(ip: string): IPVersion {
    return ip.includes(":") ? 6 : 4;
}

/**
 * Converts IPv4 or IPv6 address string to BigInt for numerical operations
 */
function ipToBigInt(ip: string): bigint {
    const version = detectIpVersion(ip);

    if (version === 4) {
        return ip.split(".").reduce((acc, octet) => {
            const num = parseInt(octet);
            if (isNaN(num) || num < 0 || num > 255) {
                throw new Error(`Invalid IPv4 octet: ${octet}`);
            }
            return BigInt.asUintN(64, (acc << BigInt(8)) + BigInt(num));
        }, BigInt(0));
    } else {
        // Handle IPv6
        // Expand :: notation
        let fullAddress = ip;
        if (ip.includes("::")) {
            const parts = ip.split("::");
            if (parts.length > 2)
                throw new Error("Invalid IPv6 address: multiple :: found");
            const missing =
                8 - (parts[0].split(":").length + parts[1].split(":").length);
            const padding = Array(missing).fill("0").join(":");
            fullAddress = `${parts[0]}:${padding}:${parts[1]}`;
        }

        return fullAddress.split(":").reduce((acc, hextet) => {
            const num = parseInt(hextet || "0", 16);
            if (isNaN(num) || num < 0 || num > 65535) {
                throw new Error(`Invalid IPv6 hextet: ${hextet}`);
            }
            return BigInt.asUintN(128, (acc << BigInt(16)) + BigInt(num));
        }, BigInt(0));
    }
}

/**
 * Converts BigInt to IP address string
 */
function bigIntToIp(num: bigint, version: IPVersion): string {
    if (version === 4) {
        const octets: number[] = [];
        for (let i = 0; i < 4; i++) {
            octets.unshift(Number(num & BigInt(255)));
            num = num >> BigInt(8);
        }
        return octets.join(".");
    } else {
        const hextets: string[] = [];
        for (let i = 0; i < 8; i++) {
            hextets.unshift(
                Number(num & BigInt(65535))
                    .toString(16)
                    .padStart(4, "0")
            );
            num = num >> BigInt(16);
        }
        // Compress zero sequences
        let maxZeroStart = -1;
        let maxZeroLength = 0;
        let currentZeroStart = -1;
        let currentZeroLength = 0;

        for (let i = 0; i < hextets.length; i++) {
            if (hextets[i] === "0000") {
                if (currentZeroStart === -1) currentZeroStart = i;
                currentZeroLength++;
                if (currentZeroLength > maxZeroLength) {
                    maxZeroLength = currentZeroLength;
                    maxZeroStart = currentZeroStart;
                }
            } else {
                currentZeroStart = -1;
                currentZeroLength = 0;
            }
        }

        if (maxZeroLength > 1) {
            hextets.splice(maxZeroStart, maxZeroLength, "");
            if (maxZeroStart === 0) hextets.unshift("");
            if (maxZeroStart + maxZeroLength === 8) hextets.push("");
        }

        return hextets
            .map((h) => (h === "0000" ? "0" : h.replace(/^0+/, "")))
            .join(":");
    }
}

/**
 * Parses an endpoint string (ip:port) handling both IPv4 and IPv6 addresses.
 * IPv6 addresses may be bracketed like [::1]:8080 or unbracketed like ::1:8080.
 * For unbracketed IPv6, the last colon-separated segment is treated as the port.
 *
 * @param endpoint The endpoint string to parse (e.g., "192.168.1.1:8080" or "[::1]:8080" or "2607:fea8::1:8080")
 * @returns An object with ip and port, or null if parsing fails
 */
export function parseEndpoint(
    endpoint: string
): { ip: string; port: number } | null {
    if (!endpoint) return null;

    // Check for bracketed IPv6 format: [ip]:port
    const bracketedMatch = endpoint.match(/^\[([^\]]+)\]:(\d+)$/);
    if (bracketedMatch) {
        const ip = bracketedMatch[1];
        const port = parseInt(bracketedMatch[2], 10);
        if (isNaN(port)) return null;
        return { ip, port };
    }

    // Check if this looks like IPv6 (contains multiple colons)
    const colonCount = (endpoint.match(/:/g) || []).length;

    if (colonCount > 1) {
        // This is IPv6 - the port is after the last colon
        const lastColonIndex = endpoint.lastIndexOf(":");
        const ip = endpoint.substring(0, lastColonIndex);
        const portStr = endpoint.substring(lastColonIndex + 1);
        const port = parseInt(portStr, 10);
        if (isNaN(port)) return null;
        return { ip, port };
    }

    // IPv4 format: ip:port
    if (colonCount === 1) {
        const [ip, portStr] = endpoint.split(":");
        const port = parseInt(portStr, 10);
        if (isNaN(port)) return null;
        return { ip, port };
    }

    return null;
}

/**
 * Formats an IP and port into a consistent endpoint string.
 * IPv6 addresses are wrapped in brackets for proper parsing.
 *
 * @param ip The IP address (IPv4 or IPv6)
 * @param port The port number
 * @returns Formatted endpoint string
 */
export function formatEndpoint(ip: string, port: number): string {
    // Check if this is IPv6 (contains colons)
    if (ip.includes(":")) {
        // Remove brackets if already present
        const cleanIp = ip.replace(/^\[|\]$/g, "");
        return `[${cleanIp}]:${port}`;
    }
    return `${ip}:${port}`;
}

/**
 * Converts CIDR to IP range
 */
export function cidrToRange(cidr: string): IPRange {
    const [ip, prefix] = cidr.split("/");
    const version = detectIpVersion(ip);
    const prefixBits = parseInt(prefix);
    const ipBigInt = ipToBigInt(ip);

    // Validate prefix length
    const maxPrefix = version === 4 ? 32 : 128;
    if (prefixBits < 0 || prefixBits > maxPrefix) {
        throw new Error(`Invalid prefix length for IPv${version}: ${prefix}`);
    }

    const shiftBits = BigInt(maxPrefix - prefixBits);
    const mask = BigInt.asUintN(
        version === 4 ? 64 : 128,
        (BigInt(1) << shiftBits) - BigInt(1)
    );
    const start = ipBigInt & ~mask;
    const end = start | mask;

    return { start, end };
}

/**
 * Finds the next available CIDR block given existing allocations
 * @param existingCidrs Array of existing CIDR blocks
 * @param blockSize Desired prefix length for the new block
 * @param startCidr Optional CIDR to start searching from
 * @returns Next available CIDR block or null if none found
 */
export function findNextAvailableCidr(
    existingCidrs: string[],
    blockSize: number,
    startCidr?: string
): string | null {
    if (!startCidr && existingCidrs.length === 0) {
        return null;
    }

    // If no existing CIDRs, use the IP version from startCidr
    const version = startCidr ? detectIpVersion(startCidr.split("/")[0]) : 4; // Default to IPv4 if no startCidr provided

    // Use appropriate default startCidr if none provided
    startCidr = startCidr || (version === 4 ? "0.0.0.0/0" : "::/0");

    // If there are existing CIDRs, ensure all are same version
    if (
        existingCidrs.length > 0 &&
        existingCidrs.some(
            (cidr) => detectIpVersion(cidr.split("/")[0]) !== version
        )
    ) {
        throw new Error("All CIDRs must be of the same IP version");
    }

    // Extract the network part from startCidr to ensure we stay in the right subnet
    const startCidrRange = cidrToRange(startCidr);

    // Convert existing CIDRs to ranges and sort them
    const existingRanges = existingCidrs
        .map((cidr) => cidrToRange(cidr))
        .sort((a, b) => (a.start < b.start ? -1 : 1));

    // Calculate block size
    const maxPrefix = version === 4 ? 32 : 128;
    const blockSizeBigInt = BigInt(1) << BigInt(maxPrefix - blockSize);

    // Start from the beginning of the given CIDR
    let current = startCidrRange.start;
    const maxIp = startCidrRange.end;

    // Iterate through existing ranges
    for (let i = 0; i <= existingRanges.length; i++) {
        const nextRange = existingRanges[i];

        // Align current to block size
        const alignedCurrent =
            current +
            ((blockSizeBigInt - (current % blockSizeBigInt)) % blockSizeBigInt);

        // Check if we've gone beyond the maximum allowed IP
        if (alignedCurrent + blockSizeBigInt - BigInt(1) > maxIp) {
            return null;
        }

        // If we're at the end of existing ranges or found a gap
        if (
            !nextRange ||
            alignedCurrent + blockSizeBigInt - BigInt(1) < nextRange.start
        ) {
            return `${bigIntToIp(alignedCurrent, version)}/${blockSize}`;
        }

        // If next range overlaps with our search space, move past it
        if (nextRange.end >= startCidrRange.start && nextRange.start <= maxIp) {
            // Move current pointer to after the current range
            current = nextRange.end + BigInt(1);
        }
    }

    return null;
}

/**
 * Checks if a given IP address is within a CIDR range
 * @param ip IP address to check
 * @param cidr CIDR range to check against
 * @returns boolean indicating if IP is within the CIDR range
 */
export function isIpInCidr(ip: string, cidr: string): boolean {
    const ipVersion = detectIpVersion(ip);
    const cidrVersion = detectIpVersion(cidr.split("/")[0]);

    // If IP versions don't match, the IP cannot be in the CIDR range
    if (ipVersion !== cidrVersion) {
        // throw new Erorr
        return false;
    }

    const ipBigInt = ipToBigInt(ip);
    const range = cidrToRange(cidr);
    return ipBigInt >= range.start && ipBigInt <= range.end;
}

export async function getNextAvailableClientSubnet(
    orgId: string,
    transaction: Transaction | typeof db = db
): Promise<string> {
    const [org] = await transaction
        .select()
        .from(orgs)
        .where(eq(orgs.orgId, orgId));

    if (!org) {
        throw new Error(`Organization with ID ${orgId} not found`);
    }

    if (!org.subnet) {
        throw new Error(`Organization with ID ${orgId} has no subnet defined`);
    }

    const existingAddressesSites = await transaction
        .select({
            address: sites.address
        })
        .from(sites)
        .where(and(isNotNull(sites.address), eq(sites.orgId, orgId)));

    const existingAddressesClients = await transaction
        .select({
            address: clients.subnet
        })
        .from(clients)
        .where(and(isNotNull(clients.subnet), eq(clients.orgId, orgId)));

    const addresses = [
        ...existingAddressesSites.map(
            (site) => `${site.address?.split("/")[0]}/32`
        ), // we are overriding the 32 so that we pick individual addresses in the subnet of the org for the site and the client even though they are stored with the /block_size of the org
        ...existingAddressesClients.map(
            (client) => `${client.address.split("/")}/32`
        )
    ].filter((address) => address !== null) as string[];

    const subnet = findNextAvailableCidr(addresses, 32, org.subnet); // pick the sites address in the org
    if (!subnet) {
        throw new Error("No available subnets remaining in space");
    }

    return subnet;
}

export async function getNextAvailableAliasAddress(
    orgId: string
): Promise<string> {
    const [org] = await db.select().from(orgs).where(eq(orgs.orgId, orgId));

    if (!org) {
        throw new Error(`Organization with ID ${orgId} not found`);
    }

    if (!org.subnet) {
        throw new Error(`Organization with ID ${orgId} has no subnet defined`);
    }

    if (!org.utilitySubnet) {
        throw new Error(
            `Organization with ID ${orgId} has no utility subnet defined`
        );
    }

    const existingAddresses = await db
        .select({
            aliasAddress: siteResources.aliasAddress
        })
        .from(siteResources)
        .where(
            and(
                isNotNull(siteResources.aliasAddress),
                eq(siteResources.orgId, orgId)
            )
        );

    const addresses = [
        ...existingAddresses.map(
            (site) => `${site.aliasAddress?.split("/")[0]}/32`
        ),
        // reserve a /29 for the dns server and other stuff
        `${org.utilitySubnet.split("/")[0]}/29`
    ].filter((address) => address !== null) as string[];

    let subnet = findNextAvailableCidr(addresses, 32, org.utilitySubnet);
    if (!subnet) {
        throw new Error("No available subnets remaining in space");
    }

    // remove the cidr
    subnet = subnet.split("/")[0];

    return subnet;
}

export async function getNextAvailableOrgSubnet(): Promise<string> {
    const existingAddresses = await db
        .select({
            subnet: orgs.subnet
        })
        .from(orgs)
        .where(isNotNull(orgs.subnet));

    const addresses = existingAddresses.map((org) => org.subnet!);

    const subnet = findNextAvailableCidr(
        addresses,
        config.getRawConfig().orgs.block_size,
        config.getRawConfig().orgs.subnet_group
    );
    if (!subnet) {
        throw new Error("No available subnets remaining in space");
    }

    return subnet;
}

export function generateRemoteSubnets(
    allSiteResources: SiteResource[]
): string[] {
    const remoteSubnets = allSiteResources
        .filter((sr) => {
            if (sr.mode === "cidr") {
                // check if its a valid CIDR using zod
                const cidrSchema = z.union([z.cidrv4(), z.cidrv6()]);
                const parseResult = cidrSchema.safeParse(sr.destination);
                return parseResult.success;
            }
            if (sr.mode === "host") {
                // check if its a valid IP using zod
                const ipSchema = z.union([z.ipv4(), z.ipv6()]);
                const parseResult = ipSchema.safeParse(sr.destination);
                return parseResult.success;
            }
            return false;
        })
        .map((sr) => {
            if (sr.mode === "cidr") return sr.destination;
            if (sr.mode === "host") {
                return `${sr.destination}/32`;
            }
            return ""; // This should never be reached due to filtering, but satisfies TypeScript
        })
        .filter((subnet) => subnet !== ""); // Remove empty strings just to be safe
    // remove duplicates
    return Array.from(new Set(remoteSubnets));
}

export type Alias = { alias: string | null; aliasAddress: string | null };

export function generateAliasConfig(allSiteResources: SiteResource[]): Alias[] {
    return allSiteResources
        .filter((sr) => sr.alias && sr.aliasAddress && sr.mode == "host")
        .map((sr) => ({
            alias: sr.alias,
            aliasAddress: sr.aliasAddress
        }));
}

export type SubnetProxyTarget = {
    sourcePrefix: string; // must be a cidr
    destPrefix: string; // must be a cidr
    disableIcmp?: boolean;
    rewriteTo?: string; // must be a cidr
    portRange?: {
        min: number;
        max: number;
        protocol: "tcp" | "udp";
    }[];
};

export function generateSubnetProxyTargets(
    siteResource: SiteResource,
    clients: {
        clientId: number;
        pubKey: string | null;
        subnet: string | null;
    }[]
): SubnetProxyTarget[] {
    const targets: SubnetProxyTarget[] = [];

    if (clients.length === 0) {
        logger.debug(
            `No clients have access to site resource ${siteResource.siteResourceId}, skipping target generation.`
        );
        return [];
    }

    for (const clientSite of clients) {
        if (!clientSite.subnet) {
            logger.debug(
                `Client ${clientSite.clientId} has no subnet, skipping for site resource ${siteResource.siteResourceId}.`
            );
            continue;
        }

        const clientPrefix = `${clientSite.subnet.split("/")[0]}/32`;
        const portRange = [
            ...parsePortRangeString(siteResource.tcpPortRangeString, "tcp"),
            ...parsePortRangeString(siteResource.udpPortRangeString, "udp")
        ];
        const disableIcmp = siteResource.disableIcmp ?? false;

        if (siteResource.mode == "host") {
            let destination = siteResource.destination;
            // check if this is a valid ip
            const ipSchema = z.union([z.ipv4(), z.ipv6()]);
            if (ipSchema.safeParse(destination).success) {
                destination = `${destination}/32`;

                targets.push({
                    sourcePrefix: clientPrefix,
                    destPrefix: destination,
                    portRange,
                    disableIcmp
                });
            }

            if (siteResource.alias && siteResource.aliasAddress) {
                // also push a match for the alias address
                targets.push({
                    sourcePrefix: clientPrefix,
                    destPrefix: `${siteResource.aliasAddress}/32`,
                    rewriteTo: destination,
                    portRange,
                    disableIcmp
                });
            }
        } else if (siteResource.mode == "cidr") {
            targets.push({
                sourcePrefix: clientPrefix,
                destPrefix: siteResource.destination,
                portRange,
                disableIcmp
            });
        }
    }

    // print a nice representation of the targets
    // logger.debug(
    //     `Generated subnet proxy targets for: ${JSON.stringify(targets, null, 2)}`
    // );

    return targets;
}

// Custom schema for validating port range strings
// Format: "80,443,8000-9000" or "*" for all ports, or empty string
export const portRangeStringSchema = z
    .string()
    .optional()
    .refine(
        (val) => {
            if (!val || val.trim() === "" || val.trim() === "*") {
                return true;
            }

            // Split by comma and validate each part
            const parts = val.split(",").map((p) => p.trim());

            for (const part of parts) {
                if (part === "") {
                    return false; // empty parts not allowed
                }

                // Check if it's a range (contains dash)
                if (part.includes("-")) {
                    const [start, end] = part.split("-").map((p) => p.trim());

                    // Both parts must be present
                    if (!start || !end) {
                        return false;
                    }

                    const startPort = parseInt(start, 10);
                    const endPort = parseInt(end, 10);

                    // Must be valid numbers
                    if (isNaN(startPort) || isNaN(endPort)) {
                        return false;
                    }

                    // Must be valid port range (1-65535)
                    if (
                        startPort < 1 ||
                        startPort > 65535 ||
                        endPort < 1 ||
                        endPort > 65535
                    ) {
                        return false;
                    }

                    // Start must be <= end
                    if (startPort > endPort) {
                        return false;
                    }
                } else {
                    // Single port
                    const port = parseInt(part, 10);

                    // Must be a valid number
                    if (isNaN(port)) {
                        return false;
                    }

                    // Must be valid port range (1-65535)
                    if (port < 1 || port > 65535) {
                        return false;
                    }
                }
            }

            return true;
        },
        {
            message:
                'Port range must be "*" for all ports, or a comma-separated list of ports and ranges (e.g., "80,443,8000-9000"). Ports must be between 1 and 65535, and ranges must have start <= end.'
        }
    );

/**
 * Parses a port range string into an array of port range objects
 * @param portRangeStr - Port range string (e.g., "80,443,8000-9000", "*", or "")
 * @param protocol - Protocol to use for all ranges (default: "tcp")
 * @returns Array of port range objects with min, max, and protocol fields
 */
export function parsePortRangeString(
    portRangeStr: string | undefined | null,
    protocol: "tcp" | "udp" = "tcp"
): { min: number; max: number; protocol: "tcp" | "udp" }[] {
    // Handle undefined or empty string - insert dummy value with port 0
    if (!portRangeStr || portRangeStr.trim() === "") {
        return [{ min: 0, max: 0, protocol }];
    }

    // Handle wildcard - return empty array (all ports allowed)
    if (portRangeStr.trim() === "*") {
        return [];
    }

    const result: { min: number; max: number; protocol: "tcp" | "udp" }[] = [];
    const parts = portRangeStr.split(",").map((p) => p.trim());

    for (const part of parts) {
        if (part.includes("-")) {
            // Range
            const [start, end] = part.split("-").map((p) => p.trim());
            const startPort = parseInt(start, 10);
            const endPort = parseInt(end, 10);
            result.push({ min: startPort, max: endPort, protocol });
        } else {
            // Single port
            const port = parseInt(part, 10);
            result.push({ min: port, max: port, protocol });
        }
    }

    return result;
}
