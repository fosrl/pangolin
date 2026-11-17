// Run with: npx tsx server/private/lib/dnsBlocklist/parse.test.ts

import assert from "node:assert/strict";
import { normalizeDomain, parseDomains } from "./parse";

// hosts format with comments and the usual header entries
const hosts = `
# Title: example hosts
127.0.0.1 localhost
127.0.0.1 localhost.localdomain
::1 localhost
255.255.255.255 broadcasthost
0.0.0.0 0.0.0.0

0.0.0.0 ads.example.com # trailing comment
0.0.0.0 Tracker.Example.NET
0.0.0.0 a.example.org b.example.org
  0.0.0.0   spaced.example.io
`;

const parsed = parseDomains(hosts);
assert.deepEqual(
    [...parsed].sort(),
    [
        "a.example.org",
        "ads.example.com",
        "b.example.org",
        "spaced.example.io",
        "tracker.example.net"
    ],
    "hosts format"
);

// plain domain list
assert.deepEqual(
    [
        ...parseDomains(
            "one.example.com\r\ntwo.example.com.\n\nnot a domain!!\n"
        )
    ].sort(),
    ["one.example.com", "two.example.com"],
    "plain list"
);

// duplicates collapse
assert.equal(parseDomains("a.example.com\nA.EXAMPLE.COM\n").size, 1, "dedupe");

// things that are not domains
for (const bad of [
    "",
    "localhost",
    "single",
    "1.2.3.44",
    "-bad.example.com",
    "exa mple.com",
    "http://example.com",
    "a".repeat(260) + ".com"
]) {
    assert.equal(normalizeDomain(bad), null, `rejects ${JSON.stringify(bad)}`);
}

assert.equal(normalizeDomain(" Example.COM. "), "example.com");
assert.equal(normalizeDomain("xn--80ak6aa92e.com"), "xn--80ak6aa92e.com");
assert.equal(normalizeDomain("_dmarc.example.com"), "_dmarc.example.com");

console.log("parse tests passed");
