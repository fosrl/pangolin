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

export type CustomZoneRecord = {
    fullDomain: string;
    type: string;
    values: string[];
    ttl: number;
    priority: number | null;
    weight: number | null;
    port: number | null;
};

export type CustomRecordMatch<T> = {
    // The records that answer for the name: its own, or those of the
    // wildcard that covers it
    records: T[];
    // Whether the name exists in the zone's custom records, including as an
    // empty non-terminal (e.g. _tcp.example.com when only
    // _imaps._tcp.example.com has records) - for NODATA vs NXDOMAIN
    nameExists: boolean;
};

// Picks which of a zone's custom records answer for `name`, following
// RFC 4592: a name with records of its own (or with records beneath it)
// is never answered by a wildcard. Otherwise the closest existing ancestor
// (the "closest encloser") is found and its wildcard, if any, answers -
// so *.example.com covers a.b.example.com unless b.example.com exists.
// Only custom record names are considered when deciding what exists.
export function matchCustomRecords<T extends { fullDomain: string }>(
    zoneRecords: T[],
    name: string,
    zone: string
): CustomRecordMatch<T> {
    const normalized = name.replace(/\.$/, "").toLowerCase();
    if (normalized !== zone && !normalized.endsWith(`.${zone}`)) {
        return { records: [], nameExists: false };
    }

    const existsAtOrBelow = (candidate: string) =>
        zoneRecords.some(
            (r) =>
                r.fullDomain === candidate ||
                r.fullDomain.endsWith(`.${candidate}`)
        );

    const exact = zoneRecords.filter((r) => r.fullDomain === normalized);
    if (exact.length > 0) {
        return { records: exact, nameExists: true };
    }
    if (normalized === zone || existsAtOrBelow(normalized)) {
        return { records: [], nameExists: true };
    }

    // Walk up to the closest encloser; the zone apex always exists, so the
    // walk never leaves the zone
    let encloser = normalized;
    do {
        encloser = encloser.slice(encloser.indexOf(".") + 1);
    } while (encloser !== zone && !existsAtOrBelow(encloser));

    const wildcard = zoneRecords.filter(
        (r) => r.fullDomain === `*.${encloser}`
    );
    return { records: wildcard, nameExists: wildcard.length > 0 };
}
