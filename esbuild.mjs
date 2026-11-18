import esbuild from "esbuild";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import { nodeExternalsPlugin } from "esbuild-node-externals";
import path from "path";
import fs from "fs";
// import { glob } from "glob";

// Read default build type from server/build.ts
let build = "oss";
const buildFile = fs.readFileSync(path.resolve("server/build.ts"), "utf8");
const m = buildFile.match(/export\s+const\s+build\s*=\s*["'](oss|saas|enterprise)["']/);
if (m) build = m[1];

const banner = `
// patch __dirname
// import { fileURLToPath } from "url";
// import path from "path";
// const __filename = fileURLToPath(import.meta.url);
// const __dirname = path.dirname(__filename);

// allow top level await
import { createRequire as topLevelCreateRequire } from "module";
const require = topLevelCreateRequire(import.meta.url);
`;

const argv = yargs(hideBin(process.argv))
    .usage("Usage: $0 -entry [string] -out [string] -build [string]")
    .option("entry", {
        alias: "e",
        describe: "Entry point file",
        type: "string",
        demandOption: true
    })
    .option("out", {
        alias: "o",
        describe: "Output file path",
        type: "string",
        demandOption: true
    })
    .option("build", {
        alias: "b",
        describe: "Build type (oss, saas, enterprise)",
        type: "string",
        choices: ["oss", "saas", "enterprise"],
        default: build
    })
    .option("metafile", {
        alias: "m",
        describe: "Write the esbuild metafile (inputs/imports) to this path",
        type: "string"
    })
    .help()
    .alias("help", "h").argv;

// generate a list of all package.json files in the monorepo
function getPackagePaths() {
    // const packagePaths = [];
    // const packageGlob = "package.json";
    // const packageJsonFiles = glob.sync(packageGlob);
    // for (const packageJsonFile of packageJsonFiles) {
    //     packagePaths.push(path.dirname(packageJsonFile) + "/package.json");
    // }
    // return packagePaths;
    return ["package.json"];
}

// Plugin to guard against bad imports from #private
function privateImportGuardPlugin() {
    return {
        name: "private-import-guard",
        setup(build) {
            const violations = [];

            build.onResolve({ filter: /^#private\// }, (args) => {
                const importingFile = args.importer;

                // Check if the importing file is NOT in server/private
                const normalizedImporter = path.normalize(importingFile);
                const isInServerPrivate = normalizedImporter.includes(
                    path.normalize("server/private")
                );

                if (!isInServerPrivate) {
                    const violation = {
                        file: importingFile,
                        importPath: args.path,
                        resolveDir: args.resolveDir
                    };
                    violations.push(violation);

                    console.log(`PRIVATE IMPORT VIOLATION:`);
                    console.log(`   File: ${importingFile}`);
                    console.log(`   Import: ${args.path}`);
                    console.log(`   Resolve dir: ${args.resolveDir || "N/A"}`);
                    console.log("");
                }

                // Return null to let the default resolver handle it
                return null;
            });

            build.onEnd((result) => {
                if (violations.length > 0) {
                    console.log(
                        `\nSUMMARY: Found ${violations.length} private import violation(s):`
                    );
                    violations.forEach((v, i) => {
                        console.log(
                            `   ${i + 1}. ${path.relative(process.cwd(), v.file)} imports ${v.importPath}`
                        );
                    });
                    console.log("");

                    result.errors.push({
                        text: `Private import violations detected: ${violations.length} violation(s) found`,
                        location: null,
                        notes: violations.map((v) => ({
                            text: `${path.relative(process.cwd(), v.file)} imports ${v.importPath}`,
                            location: null
                        }))
                    });
                }
            });
        }
    };
}

// Plugin to guard against bad imports from #private
function dynamicImportGuardPlugin() {
    return {
        name: "dynamic-import-guard",
        setup(build) {
            const violations = [];

            build.onResolve({ filter: /^#dynamic\// }, (args) => {
                const importingFile = args.importer;

                // Check if the importing file is NOT in server/private
                const normalizedImporter = path.normalize(importingFile);
                const isInServerPrivate = normalizedImporter.includes(
                    path.normalize("server/private")
                );

                if (isInServerPrivate) {
                    const violation = {
                        file: importingFile,
                        importPath: args.path,
                        resolveDir: args.resolveDir
                    };
                    violations.push(violation);

                    console.log(`DYNAMIC IMPORT VIOLATION:`);
                    console.log(`   File: ${importingFile}`);
                    console.log(`   Import: ${args.path}`);
                    console.log(`   Resolve dir: ${args.resolveDir || "N/A"}`);
                    console.log("");
                }

                // Return null to let the default resolver handle it
                return null;
            });

            build.onEnd((result) => {
                if (violations.length > 0) {
                    console.log(
                        `\nSUMMARY: Found ${violations.length} dynamic import violation(s):`
                    );
                    violations.forEach((v, i) => {
                        console.log(
                            `   ${i + 1}. ${path.relative(process.cwd(), v.file)} imports ${v.importPath}`
                        );
                    });
                    console.log("");

                    result.errors.push({
                        text: `Dynamic import violations detected: ${violations.length} violation(s) found`,
                        location: null,
                        notes: violations.map((v) => ({
                            text: `${path.relative(process.cwd(), v.file)} imports ${v.importPath}`,
                            location: null
                        }))
                    });
                }
            });
        }
    };
}

// Plugin to dynamically switch imports based on build type
function dynamicImportSwitcherPlugin(buildValue) {
    return {
        name: "dynamic-import-switcher",
        setup(build) {
            const switches = [];

            build.onStart(() => {
                console.log(
                    `Dynamic import switcher using build type: ${buildValue}`
                );
            });

            build.onResolve({ filter: /^#dynamic\// }, (args) => {
                // Extract the path after #dynamic/
                const dynamicPath = args.path.replace(/^#dynamic\//, "");

                // Determine the replacement based on build type
                let replacement;
                if (buildValue === "oss") {
                    replacement = `#open/${dynamicPath}`;
                } else if (
                    buildValue === "saas" ||
                    buildValue === "enterprise"
                ) {
                    replacement = `#closed/${dynamicPath}`; // We use #closed here so that the route guards dont complain after its been changed but this is the same as #private
                } else {
                    console.warn(
                        `Unknown build type '${buildValue}', defaulting to #open/`
                    );
                    replacement = `#open/${dynamicPath}`;
                }

                const switchInfo = {
                    file: args.importer,
                    originalPath: args.path,
                    replacementPath: replacement,
                    buildType: buildValue
                };
                switches.push(switchInfo);

                console.log(`DYNAMIC IMPORT SWITCH:`);
                console.log(`   File: ${args.importer}`);
                console.log(`   Original: ${args.path}`);
                console.log(
                    `   Switched to: ${replacement} (build: ${buildValue})`
                );
                console.log("");

                // Rewrite the import path and let the normal resolution continue
                return build.resolve(replacement, {
                    importer: args.importer,
                    namespace: args.namespace,
                    resolveDir: args.resolveDir,
                    kind: args.kind
                });
            });

            build.onEnd((result) => {
                if (switches.length > 0) {
                    console.log(
                        `\nDYNAMIC IMPORT SUMMARY: Switched ${switches.length} import(s) for build type '${buildValue}':`
                    );
                    switches.forEach((s, i) => {
                        console.log(
                            `   ${i + 1}. ${path.relative(process.cwd(), s.file)}`
                        );
                        console.log(
                            `      ${s.originalPath} → ${s.replacementPath}`
                        );
                    });
                    console.log("");
                }
            });
        }
    };
}

esbuild
    .build({
        entryPoints: [argv.entry],
        bundle: true,
        outfile: argv.out,
        format: "esm",
        minify: false,
        banner: {
            js: banner
        },
        platform: "node",
        external: ["body-parser"],
        plugins: [
            privateImportGuardPlugin(),
            dynamicImportGuardPlugin(),
            dynamicImportSwitcherPlugin(argv.build),
            nodeExternalsPlugin({
                packagePath: getPackagePaths()
            })
        ],
        sourcemap: "inline",
        metafile: Boolean(argv.metafile),
        target: "node24"
    })
    .then((result) => {
        // Check if there were any errors in the build result
        if (result.errors && result.errors.length > 0) {
            console.error(
                `Build failed with ${result.errors.length} error(s):`
            );
            result.errors.forEach((error, i) => {
                console.error(`${i + 1}. ${error.text}`);
                if (error.notes) {
                    error.notes.forEach((note) => {
                        console.error(`   - ${note.text}`);
                    });
                }
            });

            // remove the output file if it was created
            if (fs.existsSync(argv.out)) {
                fs.unlinkSync(argv.out);
            }

            process.exit(1);
        }

        if (argv.metafile) {
            fs.writeFileSync(argv.metafile, JSON.stringify(result.metafile));
        }

        console.log("Build completed successfully");
    })
    .catch((error) => {
        console.error("Build failed:", error);
        process.exit(1);
    });
