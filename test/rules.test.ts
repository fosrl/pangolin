import { assertEquals } from "./assert";
import { isPathAllowed, areAllConditionsMatched } from "../server/lib/rulesEval";

async function run() {
  // isPathAllowed tests
  assertEquals(isPathAllowed("/api/items", "/api/items"), true, "Exact path should match");
  assertEquals(isPathAllowed("/api/*", "/api/items/123"), true, "Wildcard segment should match deeper path");
  assertEquals(isPathAllowed("/api/items/*", "/api/items"), true, "Wildcard can match zero segments at end");
  assertEquals(isPathAllowed("/api/*/stats", "/api/items/stats"), true, "In-segment wildcard should match");
  assertEquals(isPathAllowed("/api/items", "/api/users"), false, "Different path should not match");

  // areAllConditionsMatched tests
  const clientIp = "203.0.113.5";
  const path = "/api/items/1";
  const ipCC = "US";
  const ipAsn = 15169;

  // All match
  let ok = await areAllConditionsMatched([
    { match: "PATH", value: "/api/items/*" },
    { match: "COUNTRY", value: "US" }
  ], clientIp, path, ipCC, ipAsn);
  assertEquals(ok, true, "PATH and COUNTRY should both match");

  // One fails
  ok = await areAllConditionsMatched([
    { match: "PATH", value: "/admin/*" },
    { match: "COUNTRY", value: "US" }
  ], clientIp, path, ipCC, ipAsn);
  assertEquals(ok, false, "PATH mismatch should fail AND");

  // ASN match with numeric rule
  ok = await areAllConditionsMatched([
    { match: "ASN", value: "15169" }
  ], clientIp, path, ipCC, ipAsn);
  assertEquals(ok, true, "ASN numeric rule should match");

  // ASN match with AS prefix
  ok = await areAllConditionsMatched([
    { match: "ASN", value: "AS15169" }
  ], clientIp, path, ipCC, ipAsn);
  assertEquals(ok, true, "ASN rule with AS prefix should match");

  // CIDR
  ok = await areAllConditionsMatched([
    { match: "CIDR", value: "203.0.113.0/24" }
  ], clientIp, path, ipCC, ipAsn);
  assertEquals(ok, true, "CIDR should match containing IP");

  console.log("rules.test.ts: All tests passed");
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
