import fs from "fs";
import path from "path";

const IOS_CASCADE_LAYERS_MIN_VERSION = [15, 4] as const;
const LEGACY_CSS_DIRECTORY = path.join(
    process.cwd(),
    ".next",
    "static",
    "legacy-ios14"
);
const LEGACY_CSS_MANIFEST = path.join(LEGACY_CSS_DIRECTORY, "manifest.json");
let cachedStylesheetHrefs: string[] | undefined;

export function isLegacyIosUserAgent(userAgent: string): boolean {
    if (/\b(?:iPhone|iPad|iPod)\b/i.test(userAgent)) {
        const versionMatch = userAgent.match(
            /\b(?:CPU (?:iPhone )?OS|iPhone OS) (\d+)(?:[_.](\d+))?/i
        );
        return !!versionMatch && isBeforeCascadeLayers(versionMatch);
    }

    if (/\bMacintosh\b.*\bMobile\//i.test(userAgent)) {
        const safariVersion = userAgent.match(/\bVersion\/(\d+)(?:\.(\d+))?/i);
        return !!safariVersion && isBeforeCascadeLayers(safariVersion);
    }

    return false;
}

function isBeforeCascadeLayers(versionMatch: RegExpMatchArray): boolean {
    const major = Number(versionMatch[1]);
    const minor = Number(versionMatch[2] || 0);
    const [minimumMajor, minimumMinor] = IOS_CASCADE_LAYERS_MIN_VERSION;

    return (
        major < minimumMajor || (major === minimumMajor && minor < minimumMinor)
    );
}

export function getLegacyIosStylesheetHrefs(): string[] {
    if (cachedStylesheetHrefs) {
        return cachedStylesheetHrefs;
    }

    try {
        const manifest = JSON.parse(
            fs.readFileSync(LEGACY_CSS_MANIFEST, "utf8")
        ) as { stylesheets?: unknown };
        if (
            !Array.isArray(manifest.stylesheets) ||
            !manifest.stylesheets.every(
                (href) =>
                    typeof href === "string" &&
                    href.startsWith("/_next/static/legacy-ios14/") &&
                    href.endsWith(".css")
            )
        ) {
            throw new Error("Invalid legacy iOS stylesheet manifest.");
        }

        cachedStylesheetHrefs = manifest.stylesheets;
    } catch (error) {
        if (
            !(error instanceof Error) ||
            !("code" in error) ||
            error.code !== "ENOENT"
        ) {
            console.error(
                "Failed to load legacy iOS stylesheet manifest",
                error
            );
        }
        cachedStylesheetHrefs = [];
    }

    return cachedStylesheetHrefs;
}
