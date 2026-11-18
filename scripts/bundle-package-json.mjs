// Writes a package.json that depends only on the npm packages an esbuild
// bundle imports at runtime, so a standalone image (e.g. Dockerfile.dns) can
// `npm install` just those instead of the full dependency tree. Versions and
// overrides come from the root package.json, and running `npm install` next
// to the root package-lock.json keeps transitive versions pinned to the lock.
//
// Usage: node scripts/bundle-package-json.mjs <metafile.json> <out/package.json>

import { isBuiltin } from "node:module";
import fs from "node:fs";
import path from "node:path";

const [metafilePath, outPath] = process.argv.slice(2);
if (!metafilePath || !outPath) {
    console.error(
        "Usage: node scripts/bundle-package-json.mjs <metafile.json> <out/package.json>"
    );
    process.exit(1);
}

const metafile = JSON.parse(fs.readFileSync(metafilePath, "utf8"));
const rootPkg = JSON.parse(fs.readFileSync("package.json", "utf8"));

// "@scope/name/sub/path" -> "@scope/name", "name/sub/path" -> "name"
function packageName(specifier) {
    const parts = specifier.split("/");
    return specifier.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0];
}

const used = new Set();
for (const output of Object.values(metafile.outputs)) {
    for (const imp of output.imports) {
        if (!imp.external || isBuiltin(imp.path)) continue;
        used.add(packageName(imp.path));
    }
}

const dependencies = {};
const missing = [];
for (const name of [...used].sort()) {
    const version = rootPkg.dependencies?.[name];
    if (version) {
        dependencies[name] = version;
    } else {
        missing.push(name);
    }
}

// A runtime import of something that is only a devDependency (or not
// declared at all) would be pruned from the image and fail at startup
if (missing.length > 0) {
    console.error(
        `Bundle imports packages not in package.json dependencies: ${missing.join(", ")}`
    );
    process.exit(1);
}

const pkg = {
    name: rootPkg.name,
    version: rootPkg.version,
    private: true,
    type: rootPkg.type,
    dependencies,
    ...(rootPkg.overrides && { overrides: rootPkg.overrides })
};

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, JSON.stringify(pkg, null, 4) + "\n");

console.log(
    `Wrote ${outPath} with ${Object.keys(dependencies).length} dependencies: ${Object.keys(dependencies).join(", ")}`
);
