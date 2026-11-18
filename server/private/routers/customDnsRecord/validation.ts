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

import { isIPv4, isIPv6 } from "net";
import { z } from "zod";
import {
    db,
    customDnsRecords,
    domains,
    domainNamespaces,
    loginPage,
    orgDomains,
    redirects,
    resources
} from "@server/db";
import { and, eq, inArray, isNull, or } from "drizzle-orm";
import HttpCode from "@server/types/HttpCode";
import { privateConfig as config } from "#private/lib/config";
import {
    CUSTOM_DNS_RECORD_TYPES,
    CustomDnsRecordType,
    parseCustomDnsRecordValues
} from "@server/routers/customDnsRecord/types";

export const MAX_CUSTOM_DNS_RECORDS_PER_DOMAIN = 100;
// Caps the number of values (resource records) any single RRset the DNS
// server can be made to return, which bounds how much a spoofed UDP query
// can be amplified.
export const MAX_CUSTOM_DNS_VALUES_PER_RRSET = 10;
export const MAX_TXT_VALUE_LENGTH = 1024;
export const MIN_TTL = 60;
export const MAX_TTL = 86400;

// Underscores are allowed so service labels like _dmarc, _sip._tcp and
// selector._domainkey can be used.
const LABEL_REGEX = /^[a-z0-9_](?:[a-z0-9_-]{0,61}[a-z0-9_])?$/;
// Printable ASCII only - no control characters or non-ASCII bytes in TXT data.
const TXT_REGEX = /^[\x20-\x7e]+$/;

const uint16 = z.number().int().min(0).max(65535);

export const customDnsRecordFieldsSchema = z.strictObject({
    name: z.string().max(253),
    type: z.enum(CUSTOM_DNS_RECORD_TYPES),
    values: z
        .array(
            z
                .string()
                .min(1)
                .max(MAX_TXT_VALUE_LENGTH + 2) // + surrounding quotes
        )
        .min(1)
        .max(MAX_CUSTOM_DNS_VALUES_PER_RRSET),
    ttl: z.number().int().min(MIN_TTL).max(MAX_TTL),
    priority: uint16.nullable().optional(),
    weight: uint16.nullable().optional(),
    port: uint16.nullable().optional(),
    enabled: z.boolean()
});

export type CustomDnsRecordInput = z.infer<typeof customDnsRecordFieldsSchema>;

export type NormalizedCustomDnsRecord = {
    name: string;
    fullDomain: string;
    type: CustomDnsRecordType;
    values: string[];
    ttl: number;
    priority: number | null;
    weight: number | null;
    port: number | null;
    enabled: boolean;
};

type Result<T> = { ok: true; value: T } | { ok: false; error: string };

type ManageableDomainResult =
    | { ok: true; domainId: string; baseDomain: string }
    | { ok: false; status: number; error: string };

function isValidHostname(host: string): boolean {
    if (host.length === 0 || host.length > 253 || !host.includes(".")) {
        return false;
    }
    return host.split(".").every((label) => LABEL_REGEX.test(label));
}

function normalizeHostname(value: string): string {
    return value.trim().toLowerCase().replace(/\.$/, "");
}

function isAtOrBelow(name: string, zone: string): boolean {
    const normalizedZone = zone.toLowerCase().replace(/\.$/, "");
    return name === normalizedZone || name.endsWith(`.${normalizedZone}`);
}

// Loads the domain and makes sure custom records may be managed on it: it
// must belong to the org, be delegated to our nameservers (type "ns"), and
// belong to this org alone so one org can never publish records under a
// domain another org also uses (e.g. a shared/provided namespace domain).
export async function getManageableDomain(
    orgId: string,
    domainId: string
): Promise<ManageableDomainResult> {
    const [row] = await db
        .select({
            domainId: domains.domainId,
            baseDomain: domains.baseDomain,
            type: domains.type
        })
        .from(domains)
        .innerJoin(orgDomains, eq(orgDomains.domainId, domains.domainId))
        .where(and(eq(domains.domainId, domainId), eq(orgDomains.orgId, orgId)))
        .limit(1);

    if (!row) {
        return {
            ok: false,
            status: HttpCode.NOT_FOUND,
            error: `Domain with ID ${domainId} not found`
        };
    }

    if (row.type !== "ns") {
        return {
            ok: false,
            status: HttpCode.BAD_REQUEST,
            error: "Custom DNS records can only be added to domains delegated to Pangolin's nameservers (NS domains)"
        };
    }

    const [namespace] = await db
        .select({ domainNamespaceId: domainNamespaces.domainNamespaceId })
        .from(domainNamespaces)
        .where(eq(domainNamespaces.domainId, domainId))
        .limit(1);

    const linkedOrgs = await db
        .select({ orgId: orgDomains.orgId })
        .from(orgDomains)
        .where(eq(orgDomains.domainId, domainId));

    if (namespace || linkedOrgs.length !== 1) {
        return {
            ok: false,
            status: HttpCode.FORBIDDEN,
            error: "Custom DNS records cannot be added to shared domains"
        };
    }

    return {
        ok: true,
        domainId: row.domainId,
        baseDomain: row.baseDomain.toLowerCase()
    };
}

function normalizeName(
    name: string,
    baseDomain: string
): Result<{ name: string; fullDomain: string }> {
    let relative = name.trim().toLowerCase().replace(/\.$/, "");

    if (relative === "" || relative === "@" || relative === baseDomain) {
        return { ok: true, value: { name: "@", fullDomain: baseDomain } };
    }

    // Accept the name typed as an FQDN within this domain as well
    if (relative.endsWith(`.${baseDomain}`)) {
        relative = relative.slice(0, -(baseDomain.length + 1));
    }

    const labels = relative.split(".");
    for (let i = 0; i < labels.length; i++) {
        const label = labels[i];
        if (label === "*" && i === 0) {
            continue;
        }
        if (!LABEL_REGEX.test(label)) {
            return {
                ok: false,
                error: `Invalid record name "${name}". Labels may only contain letters, numbers, hyphens and underscores, and "*" is only allowed as the leftmost label.`
            };
        }
    }

    // ACME challenge names are served by Pangolin itself for certificate
    // issuance - letting users write there would let them influence DNS-01
    // validation.
    if (labels.includes("_acme-challenge")) {
        return {
            ok: false,
            error: "_acme-challenge records are managed by Pangolin and cannot be added"
        };
    }

    const fullDomain = `${relative}.${baseDomain}`;
    if (fullDomain.length > 253) {
        return { ok: false, error: "Record name is too long" };
    }

    return { ok: true, value: { name: relative, fullDomain } };
}

function normalizeValue(
    type: CustomDnsRecordType,
    rawValue: string
): Result<string> {
    switch (type) {
        case "A": {
            const value = rawValue.trim();
            if (!isIPv4(value)) {
                return {
                    ok: false,
                    error: `"${value}" is not an IPv4 address`
                };
            }
            return { ok: true, value };
        }
        case "AAAA": {
            const value = rawValue.trim().toLowerCase();
            if (!isIPv6(value)) {
                return {
                    ok: false,
                    error: `"${value}" is not an IPv6 address`
                };
            }
            return { ok: true, value };
        }
        case "CNAME":
        case "NS":
        case "MX":
        case "SRV": {
            const value = normalizeHostname(rawValue);
            if (!isValidHostname(value)) {
                return {
                    ok: false,
                    error: `${type} records require fully qualified hostnames as values`
                };
            }
            return { ok: true, value };
        }
        case "TXT": {
            let value = rawValue;
            // Strip one pair of surrounding quotes, as commonly pasted from
            // zone files and provider instructions
            if (
                value.length >= 2 &&
                value.startsWith('"') &&
                value.endsWith('"')
            ) {
                value = value.slice(1, -1);
            }
            if (value.length === 0 || value.length > MAX_TXT_VALUE_LENGTH) {
                return {
                    ok: false,
                    error: `TXT values must be between 1 and ${MAX_TXT_VALUE_LENGTH} characters`
                };
            }
            if (!TXT_REGEX.test(value)) {
                return {
                    ok: false,
                    error: "TXT values may only contain printable ASCII characters"
                };
            }
            return { ok: true, value };
        }
    }
}

// Validates and normalizes a record's fields without touching the database.
export function normalizeCustomDnsRecord(
    input: CustomDnsRecordInput,
    baseDomain: string
): Result<NormalizedCustomDnsRecord> {
    const nameResult = normalizeName(input.name, baseDomain);
    if (!nameResult.ok) {
        return nameResult;
    }
    const { name, fullDomain } = nameResult.value;
    const isApex = name === "@";
    const isWildcard = name.startsWith("*");

    let priority: number | null = null;
    let weight: number | null = null;
    let port: number | null = null;

    const values: string[] = [];
    for (const rawValue of input.values) {
        const valueResult = normalizeValue(input.type, rawValue);
        if (!valueResult.ok) {
            return valueResult;
        }
        if (values.includes(valueResult.value)) {
            return {
                ok: false,
                error: `Duplicate value "${valueResult.value}"`
            };
        }
        values.push(valueResult.value);
    }

    if (input.type === "CNAME") {
        if (isApex) {
            return {
                ok: false,
                error: "CNAME records cannot be added at the root of the domain"
            };
        }
        if (values.length > 1) {
            return {
                ok: false,
                error: "A CNAME record can only have one value"
            };
        }
        if (values[0] === fullDomain) {
            return {
                ok: false,
                error: "A CNAME record cannot point to itself"
            };
        }
    }

    if (input.type === "NS" && (isApex || isWildcard)) {
        return {
            ok: false,
            error: "NS records can only be added for a specific subdomain, not the root or a wildcard"
        };
    }

    if (input.type === "MX" || input.type === "SRV") {
        if (input.priority == null) {
            return {
                ok: false,
                error: `${input.type} records require a priority`
            };
        }
        priority = input.priority;
    }

    if (input.type === "SRV") {
        if (input.weight == null || input.port == null) {
            return {
                ok: false,
                error: "SRV records require a weight and a port"
            };
        }
        weight = input.weight;
        port = input.port;
    }

    return {
        ok: true,
        value: {
            name,
            fullDomain,
            type: input.type,
            values,
            ttl: input.ttl,
            priority,
            weight,
            port,
            enabled: input.enabled
        }
    };
}

// Checks a normalized record against everything else that lives in DNS:
// infrastructure zones, other customers' zones, Pangolin-managed names and
// the domain's other custom records. Returns an error message, or null.
export async function checkCustomDnsRecordConflicts(
    domainId: string,
    baseDomain: string,
    record: NormalizedCustomDnsRecord,
    excludeRecordId?: number
): Promise<string | null> {
    const { fullDomain, type } = record;

    // Names the DNS server answers for itself (nameservers, cname/site
    // extensions, configured zones) are never user-writable.
    const dnsConfig = config.getRawConfig().dns;
    const reservedZones = [
        dnsConfig?.nameserver_name,
        dnsConfig?.cname_extension,
        dnsConfig?.site_extension,
        ...(dnsConfig?.cname_alternate_extensions ?? []),
        ...(dnsConfig?.zones ?? [])
    ].filter((z): z is string => !!z);
    if (reservedZones.some((zone) => isAtOrBelow(fullDomain, zone))) {
        return "This name is reserved and cannot be used";
    }

    // A name inside a more specific domain (e.g. sub.example.com added to
    // Pangolin separately, possibly by another org) belongs to that zone,
    // not this one.
    const labels = fullDomain.split(".");
    const baseLabelCount = baseDomain.split(".").length;
    const childZoneCandidates: string[] = [];
    for (let i = 0; i < labels.length - baseLabelCount; i++) {
        childZoneCandidates.push(labels.slice(i).join("."));
    }
    if (childZoneCandidates.length > 0) {
        const [childZone] = await db
            .select({ domainId: domains.domainId })
            .from(domains)
            .where(inArray(domains.baseDomain, childZoneCandidates))
            .limit(1);
        if (childZone) {
            return "This name belongs to a different domain in Pangolin";
        }
    }

    const existing = (
        await db
            .select()
            .from(customDnsRecords)
            .where(eq(customDnsRecords.domainId, domainId))
    ).filter((r) => r.customDnsRecordId !== excludeRecordId);

    // existing excludes the record being updated, so this only trips when
    // adding a new record would go over the limit
    if (existing.length >= MAX_CUSTOM_DNS_RECORDS_PER_DOMAIN) {
        return `A domain can have at most ${MAX_CUSTOM_DNS_RECORDS_PER_DOMAIN} custom DNS records`;
    }

    const sameName = existing.filter((r) => r.fullDomain === fullDomain);

    if (type === "CNAME" && sameName.length > 0) {
        return "A CNAME record cannot be added to a name that already has other records";
    }
    if (type !== "CNAME" && sameName.some((r) => r.type === "CNAME")) {
        return "This name already has a CNAME record, which cannot be combined with other records";
    }

    // One record per name and type (per priority/weight/port for MX and
    // SRV) - more values go into that record rather than a second one, so
    // the table shows the whole set in one place.
    const sameRRset = sameName.filter((r) => r.type === type);
    if (
        sameRRset.some(
            (r) =>
                r.priority === record.priority &&
                r.weight === record.weight &&
                r.port === record.port
        )
    ) {
        return `A ${type} record for this name already exists. Edit it to add more values.`;
    }

    // MX and SRV can still be split across several records (one per
    // priority), so cap the values across all of them
    const totalValues =
        record.values.length +
        sameRRset.reduce(
            (sum, r) => sum + parseCustomDnsRecordValues(r.values).length,
            0
        );
    if (totalValues > MAX_CUSTOM_DNS_VALUES_PER_RRSET) {
        return `A name can have at most ${MAX_CUSTOM_DNS_VALUES_PER_RRSET} ${type} values`;
    }

    // Delegations: a subdomain with NS records is handed off to other
    // nameservers, and the DNS server refers every query at or beneath it
    // there. Nothing else may live at or beneath it except A/AAAA glue for
    // nameservers named inside it, or it would silently stop resolving.
    const isStrictlyBelow = (name: string, parent: string) =>
        name.endsWith(`.${parent}`);
    const isGlue =
        (type === "A" || type === "AAAA") && !record.name.startsWith("*");

    const enclosingCut = existing.find(
        (r) => r.type === "NS" && isStrictlyBelow(fullDomain, r.fullDomain)
    );
    if (enclosingCut) {
        if (type === "NS") {
            return `This name is inside the delegated subdomain ${enclosingCut.fullDomain}, so it cannot be delegated again`;
        }
        if (!isGlue) {
            return `This name is inside the delegated subdomain ${enclosingCut.fullDomain}, where only A and AAAA records for its nameservers can be added`;
        }
    }

    if (type === "NS") {
        if (sameName.some((r) => r.type !== "NS")) {
            return "A delegated subdomain can only have NS records. Remove the other records for this name first.";
        }
        if (
            existing.some(
                (r) =>
                    isStrictlyBelow(r.fullDomain, fullDomain) &&
                    ((r.type !== "A" && r.type !== "AAAA") ||
                        r.name.startsWith("*"))
            )
        ) {
            return "Records exist beneath this name that would stop resolving once it is delegated. Remove them first.";
        }

        const isAtOrBelowCut = (name: string | null) =>
            !!name &&
            (name.toLowerCase() === fullDomain ||
                isStrictlyBelow(name.toLowerCase(), fullDomain));
        const resourceNames = await db
            .select({ fullDomain: resources.fullDomain })
            .from(resources)
            .where(eq(resources.domainId, domainId));
        const pageNames = await db
            .select({ fullDomain: loginPage.fullDomain })
            .from(loginPage)
            .where(eq(loginPage.domainId, domainId));
        const redirectNames = (
            await db
                .select({ subdomain: redirects.subdomain })
                .from(redirects)
                .where(
                    and(
                        eq(redirects.domainId, domainId),
                        isNull(redirects.resourceId)
                    )
                )
        ).map((r) => (r.subdomain ? `${r.subdomain}.${baseDomain}` : null));

        if (
            [...resourceNames, ...pageNames].some((r) =>
                isAtOrBelowCut(r.fullDomain)
            ) ||
            redirectNames.some(isAtOrBelowCut)
        ) {
            return "Pangolin resources use names at or beneath this subdomain, so it cannot be delegated";
        }
    } else if (sameName.some((r) => r.type === "NS")) {
        return "This name is delegated with NS records, so other records cannot be added to it";
    }

    // Pangolin answers address queries for resources, login pages and
    // redirects itself, so a custom A/AAAA/CNAME there would never be served
    // (or, for CNAME, would conflict with the managed addresses).
    if (type === "A" || type === "AAAA" || type === "CNAME") {
        const [resource] = await db
            .select({ resourceId: resources.resourceId })
            .from(resources)
            .where(
                or(
                    eq(resources.fullDomain, fullDomain),
                    // a wildcard resource also serving this as its base
                    and(
                        eq(resources.fullDomain, `*.${fullDomain}`),
                        eq(resources.matchBaseDomain, true)
                    )
                )
            )
            .limit(1);
        const [page] = await db
            .select({ loginPageId: loginPage.loginPageId })
            .from(loginPage)
            .where(eq(loginPage.fullDomain, fullDomain))
            .limit(1);
        const [redirect] = await db
            .select({ redirectId: redirects.redirectId })
            .from(redirects)
            .where(
                and(
                    eq(redirects.domainId, domainId),
                    record.name === "@"
                        ? isNull(redirects.subdomain)
                        : eq(redirects.subdomain, record.name)
                )
            )
            .limit(1);

        if (resource || page || redirect) {
            return `This name is already in use by Pangolin, so ${type} records cannot be added to it`;
        }
    }

    return null;
}
