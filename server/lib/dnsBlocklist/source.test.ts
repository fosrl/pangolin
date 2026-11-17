// Run with: npx tsx server/private/lib/dnsBlocklist/source.test.ts

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { FileBlocklistSource } from "./source";

async function main() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "blocklists-"));
    try {
        fs.mkdirSync(path.join(dir, "alternates", "social"), {
            recursive: true
        });
        fs.mkdirSync(path.join(dir, "alternates", "porn"), {
            recursive: true
        });

        const base = "0.0.0.0 ads.example.com\n0.0.0.0 tracker.example.net\n";
        fs.writeFileSync(path.join(dir, "hosts"), base);
        // alternates contain the base list plus their own category
        fs.writeFileSync(
            path.join(dir, "alternates", "social", "hosts"),
            base + "0.0.0.0 social.example.org\n"
        );

        const source = new FileBlocklistSource(dir);

        assert.deepEqual(
            [...(await source.getCategoryDomains("ads"))].sort(),
            ["ads.example.com", "tracker.example.net"],
            "ads is the base list"
        );
        assert.deepEqual(
            [...(await source.getCategoryDomains("social"))],
            ["social.example.org"],
            "a category is its file minus the base list"
        );
        assert.equal(
            (await source.getCategoryDomains("adult")).size,
            0,
            "an empty alternates file is an empty category"
        );
        assert.equal(
            (await source.getCategoryDomains("gambling")).size,
            0,
            "a missing file is an empty category"
        );

        // a changed file is picked up and changes the version
        const versionBefore = await source.getVersion();
        await new Promise((r) => setTimeout(r, 20));
        fs.writeFileSync(
            path.join(dir, "alternates", "social", "hosts"),
            base + "0.0.0.0 social.example.org\n0.0.0.0 more.example.org\n"
        );
        assert.notEqual(await source.getVersion(), versionBefore);
        assert.deepEqual(
            [...(await source.getCategoryDomains("social"))].sort(),
            ["more.example.org", "social.example.org"],
            "reloaded after the file changed"
        );

        console.log("source tests passed");
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
}

main().then(
    () => process.exit(0),
    (error) => {
        console.error(error);
        process.exit(1);
    }
);
