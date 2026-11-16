#!/usr/bin/env node
// Keep messages/en-US.json in sync with the code.
//
//   node scripts/check-translations.mjs          report unused and missing keys
//   node scripts/check-translations.mjs --check  same, but exit 1 if there are any
//   node scripts/check-translations.mjs --write  remove unused keys from en-US.json
//
// Unused: a key counts as used if its full name appears as a string literal
// anywhere in src/, server/, dynamic/ or cli/ (so keys passed around in config
// objects like `title: "sidebarSites"` are kept), or if it matches a template
// literal such as t(`loadBalancingStrategy_${strategy}`). Only en-US.json is
// edited; Crowdin drops the removed keys from the other locales on the next sync.
//
// Missing: every t("key") / t.rich("key") / t.markup("key") / t.raw("key") call
// with a literal key must have that key in en-US.json. Keys built at runtime
// (t(item.title), t(`${mode}Settings`)) can't be checked statically.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const messagesPath = path.join(root, "messages/en-US.json");
const write = process.argv.includes("--write");
const check = process.argv.includes("--check");

const messages = JSON.parse(fs.readFileSync(messagesPath, "utf8"));

function flatten(obj, prefix = "") {
    return Object.entries(obj).flatMap(([k, v]) =>
        v && typeof v === "object"
            ? flatten(v, `${prefix}${k}.`)
            : [`${prefix}${k}`]
    );
}

function listSources(dir, out = []) {
    if (!fs.existsSync(dir)) return out;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === "node_modules" || entry.name === ".next") continue;
        const p = path.join(dir, entry.name);
        if (entry.isDirectory()) listSources(p, out);
        else if (/\.(tsx?|jsx?|mjs)$/.test(entry.name)) out.push(p);
    }
    return out;
}

// Blank out comments but keep newlines so line numbers still line up.
// The `[^:]` guard leaves URLs like "https://..." alone.
function stripComments(source) {
    return source
        .replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, " "))
        .replace(/(^|[^:"'`])\/\/[^\n]*/g, (c, pre) => pre);
}

const files = ["src", "server", "dynamic", "cli"]
    .flatMap((d) => listSources(path.join(root, d)))
    .map((file) => ({ file, code: fs.readFileSync(file, "utf8") }));
const allCode = files.map((f) => f.code).join("\n");
const keys = flatten(messages);
const keySet = new Set(keys);

// --- unused keys ---

const literals = new Set(
    [...allCode.matchAll(/["'`]([A-Za-z0-9_.\-]+)["'`]/g)].map((m) => m[1])
);

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const templatePatterns = [
    ...new Set(
        [...allCode.matchAll(/`([^`\n]*\$\{[^`\n]*)`/g)].map((m) => m[1])
    )
]
    .map((t) => t.split(/\$\{[^}]*\}/))
    .filter((parts) => parts.some((p) => /^[A-Za-z0-9_.]*$/.test(p)))
    .filter((parts) => parts.join("").length >= 3)
    .map((parts) => new RegExp(`^${parts.map(escape).join("[A-Za-z0-9_]+")}$`));

const unused = keys.filter(
    (key) => !literals.has(key) && !templatePatterns.some((re) => re.test(key))
);

// --- missing keys ---

const missing = [];
for (const { file, code } of files) {
    const stripped = stripComments(code);
    const calls = stripped.matchAll(
        /(?<![\w.$])t(?:\.(?:rich|markup|raw))?\(\s*(["'`])([^"'`$\n]+)\1/g
    );
    for (const m of calls) {
        if (keySet.has(m[2])) continue;
        const line = stripped.slice(0, m.index).split("\n").length;
        missing.push(`${path.relative(root, file)}:${line}  ${m[2]}`);
    }
}

// --- output ---

if (write) {
    const remove = (obj, [head, ...rest]) => {
        if (!(head in obj)) return;
        if (rest.length === 0) delete obj[head];
        else {
            remove(obj[head], rest);
            if (Object.keys(obj[head]).length === 0) delete obj[head];
        }
    };
    for (const key of unused) remove(messages, key.split("."));
    fs.writeFileSync(messagesPath, JSON.stringify(messages, null, 4) + "\n");
    console.error(
        `Removed ${unused.length} unused keys from messages/en-US.json.`
    );
    process.exit(0);
}

if (unused.length) {
    console.log(`Unused keys in messages/en-US.json (${unused.length}):`);
    console.log(unused.map((k) => `  ${k}`).join("\n"));
    console.log("Run `npm run translations:prune` to remove them.\n");
}
if (missing.length) {
    console.log(
        `Keys used in code but missing from messages/en-US.json (${missing.length}):`
    );
    console.log(missing.map((m) => `  ${m}`).join("\n"));
    console.log("Add these to messages/en-US.json.\n");
}
if (!unused.length && !missing.length) {
    console.log("messages/en-US.json matches the code.");
}
process.exit(check && (unused.length || missing.length) ? 1 : 0);
