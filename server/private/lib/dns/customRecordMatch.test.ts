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

import { matchCustomRecords } from "./customRecordMatch";
import { assertEquals } from "@test/assert";

const zone = "example.com";

function record(fullDomain: string, type = "A") {
    return {
        fullDomain,
        type,
        values: ["192.0.2.1"],
        ttl: 300,
        priority: null,
        weight: null,
        port: null
    };
}

const zoneRecords = [
    record("example.com"),
    record("example.com", "MX"),
    record("coder.example.com"),
    record("*.coder.example.com"),
    record("fleet.example.com", "NS"),
    record("_imaps._tcp.example.com", "SRV"),
    record("_submission._tcp.example.com", "SRV"),
    record("app.nested.coder.example.com"),
    record("*.svc.example.com"),
    record("*.x.svc.example.com", "TXT")
];

function names(name: string) {
    return matchCustomRecords(zoneRecords, name, zone)
        .records.map((r) => `${r.fullDomain}/${r.type}`)
        .sort()
        .join(",");
}

function exists(name: string) {
    return matchCustomRecords(zoneRecords, name, zone).nameExists;
}

function testExactMatches() {
    console.log("Running exact match tests...");

    assertEquals(
        names("example.com"),
        "example.com/A,example.com/MX",
        "apex returns all its records"
    );
    assertEquals(
        names("coder.example.com"),
        "coder.example.com/A",
        "an exact name is never answered by its child wildcard"
    );
    assertEquals(
        names("Coder.Example.Com."),
        "coder.example.com/A",
        "names are matched case-insensitively and without a trailing dot"
    );
    assertEquals(
        names("*.coder.example.com"),
        "*.coder.example.com/A",
        "the wildcard owner name itself matches literally"
    );
}

function testWildcards() {
    console.log("Running wildcard tests...");

    assertEquals(
        names("foo.coder.example.com"),
        "*.coder.example.com/A",
        "single-label name below a wildcard"
    );
    assertEquals(
        names("bar.baz.coder.example.com"),
        "*.coder.example.com/A",
        "multi-label name below a wildcard (RFC 4592)"
    );
    assertEquals(
        names("a.b.c.coder.example.com"),
        "*.coder.example.com/A",
        "deeply nested name below a wildcard"
    );
    assertEquals(
        names("other.nested.coder.example.com"),
        "",
        "an existing intermediate name blocks the wildcard above it"
    );
    assertEquals(
        exists("other.nested.coder.example.com"),
        false,
        "a blocked name is NXDOMAIN"
    );
    assertEquals(
        names("a.b.x.svc.example.com"),
        "*.x.svc.example.com/TXT",
        "the closest wildcard wins over one further up"
    );
    assertEquals(
        names("q.svc.example.com"),
        "*.svc.example.com/A",
        "a sibling of a nested wildcard uses the outer one"
    );
    assertEquals(
        names("unknown.example.com"),
        "",
        "no wildcard at the apex means nothing matches"
    );
    assertEquals(
        exists("unknown.example.com"),
        false,
        "an unknown name is NXDOMAIN"
    );
}

function testEmptyNonTerminals() {
    console.log("Running empty non-terminal tests...");

    assertEquals(
        names("_tcp.example.com"),
        "",
        "an empty non-terminal has no records"
    );
    assertEquals(
        exists("_tcp.example.com"),
        true,
        "an empty non-terminal exists (NODATA, not NXDOMAIN)"
    );
    assertEquals(
        names("nested.coder.example.com"),
        "",
        "an empty non-terminal is not answered by the wildcard above it"
    );
    assertEquals(
        exists("nested.coder.example.com"),
        true,
        "an empty non-terminal under a wildcard still exists"
    );
    assertEquals(
        exists("svc.example.com"),
        true,
        "a wildcard's parent exists"
    );
    assertEquals(
        exists("x.svc.example.com"),
        true,
        "a nested wildcard's parent exists"
    );
}

function testOutsideZone() {
    console.log("Running out-of-zone tests...");

    assertEquals(
        names("example.org"),
        "",
        "names outside the zone never match"
    );
    assertEquals(
        names("notexample.com"),
        "",
        "a name that merely ends with the zone string does not match"
    );
    assertEquals(exists("com"), false, "the zone's parent does not exist");
}

testExactMatches();
testWildcards();
testEmptyNonTerminals();
testOutsideZone();
console.log("All custom record match tests passed");
