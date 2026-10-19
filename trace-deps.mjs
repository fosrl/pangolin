// Copies only the node_modules files that the bundled server entry points can
// actually load into an output directory, so the Docker image does not need
// the full production node_modules tree (most of which is UI-only code that
// Next.js has already compiled into .next).
//
// Usage: node trace-deps.mjs -o <outDir> <entry.mjs> [entry.mjs...]
//
// Uses the copy of @vercel/nft that ships with Next.js (the same tracer Next
// uses for its standalone output), so it works after `npm prune --omit=dev`.

import nft from "next/dist/compiled/@vercel/nft/index.js";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import path from "path";
import fs from "fs";

const argv = yargs(hideBin(process.argv))
    .usage("Usage: $0 -o [string] <entry...>")
    .option("out", {
        alias: "o",
        describe: "Directory to copy the traced node_modules files into",
        type: "string",
        demandOption: true
    })
    .demandCommand(1)
    .help()
    .alias("help", "h").argv;

const { nodeFileTrace } = nft;
const base = process.cwd();
const outDir = path.resolve(argv.out);

const { fileList, warnings } = await nodeFileTrace(
    argv._.map((entry) => path.resolve(String(entry))),
    {
        base,
        // Next.js is traced by `next build` for the standalone output (which
        // includes next/dist/server/next, the entry createNextServer uses).
        // Tracing it from here would pull in its dev server and bundlers.
        ignore: (file) => file.startsWith("node_modules/next/")
    }
);

// Unresolvable optional requires are expected (native binaries for other
// platforms, pg-native, bufferutil, ...), so only list them on request
if (process.env.TRACE_VERBOSE) {
    for (const warning of warnings) {
        console.warn(`trace warning: ${warning.message}`);
    }
} else if (warnings.size > 0) {
    console.log(
        `${warnings.size} trace warnings (set TRACE_VERBOSE=1 to list them)`
    );
}

let count = 0;
for (const file of fileList) {
    if (!file.startsWith("node_modules/")) continue;

    const src = path.join(base, file);
    const dest = path.join(outDir, file);
    const stat = fs.lstatSync(src);
    if (stat.isDirectory() || fs.existsSync(dest)) continue;

    fs.mkdirSync(path.dirname(dest), { recursive: true });
    if (stat.isSymbolicLink()) {
        fs.symlinkSync(fs.readlinkSync(src), dest);
    } else {
        fs.copyFileSync(src, dest);
        fs.chmodSync(dest, stat.mode);
    }
    count++;
}

console.log(`Traced ${count} node_modules files into ${outDir}`);
