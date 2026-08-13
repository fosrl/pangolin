import crypto from "crypto";
import fs from "fs";
import path from "path";
import postcss from "postcss";

const rootDir = process.cwd();
const nextDir = path.join(rootDir, ".next");
const staticChunksDir = path.join(nextDir, "static", "chunks");
const legacyCssDir = path.join(nextDir, "static", "legacy-ios14");
const legacyManifestPath = path.join(legacyCssDir, "manifest.json");

function walkFiles(dir, predicate, files = []) {
    if (!fs.existsSync(dir)) {
        return files;
    }

    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            walkFiles(fullPath, predicate, files);
        } else if (predicate(fullPath)) {
            files.push(fullPath);
        }
    }

    return files;
}

function stripLayerAtRules(css) {
    const root = postcss.parse(css);

    root.walkAtRules("layer", (atRule) => {
        if (atRule.nodes?.length) {
            atRule.replaceWith(...atRule.nodes);
        } else {
            atRule.remove();
        }
    });

    return root.toString();
}

function transformCssChunks() {
    const cssFiles = walkFiles(staticChunksDir, (file) =>
        file.endsWith(".css")
    ).sort();
    const layeredCssFiles = cssFiles.filter((file) =>
        fs.readFileSync(file, "utf8").includes("@layer")
    );

    fs.rmSync(legacyCssDir, { recursive: true, force: true });

    if (layeredCssFiles.length !== 1) {
        throw new Error(
            `Expected exactly one layered CSS bundle, found ${layeredCssFiles.length}. ` +
                "Review the auth route CSS order before updating the compatibility build."
        );
    }

    const source = fs.readFileSync(layeredCssFiles[0], "utf8");
    const output = stripLayerAtRules(source);
    if (!output || output.includes("@layer")) {
        throw new Error(
            "Legacy CSS generation did not remove all @layer rules."
        );
    }

    const contentHash = crypto
        .createHash("sha256")
        .update(output)
        .digest("hex")
        .slice(0, 16);
    const legacyCssName = `auth-ios14.${contentHash}.css`;
    const legacyCssHref = `/_next/static/legacy-ios14/${legacyCssName}`;

    fs.mkdirSync(legacyCssDir, { recursive: true });
    fs.writeFileSync(path.join(legacyCssDir, legacyCssName), output);
    fs.writeFileSync(
        legacyManifestPath,
        JSON.stringify({ stylesheets: [legacyCssHref] })
    );

    return {
        stylesheets: 1,
        colorMixDeclarations: (output.match(/color-mix\(/g) || []).length,
        unsupportedHasSelectors: (output.match(/:has\(/g) || []).length
    };
}

if (!fs.existsSync(nextDir)) {
    throw new Error(
        ".next does not exist. Run next build before compat-ios14."
    );
}

const result = transformCssChunks();

console.log(
    `compat-ios14 complete: generated ${result.stylesheets} legacy CSS bundle; ` +
        `${result.colorMixDeclarations} color-mix declarations and ` +
        `${result.unsupportedHasSelectors} :has selectors remain as progressive enhancements`
);
