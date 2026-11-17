import fs from "fs/promises";
import path from "path";
import { APP_PATH } from "@server/lib/consts";
import logger from "@server/logger";
import config from "@server/lib/config";
import { parseDomains } from "./parse";

export { normalizeDomain, parseDomains } from "./parse";

// The blocking categories an admin can pick for a role. The ids are what is
// stored on the role and shown in the dashboard, so they are neutral names that
// do not depend on where the lists come from.
export const DNS_BLOCK_CATEGORIES = [
    "ads",
    "fakenews",
    "gambling",
    "adult",
    "social"
] as const;

export type DnsBlockCategory = (typeof DNS_BLOCK_CATEGORIES)[number];

export function isDnsBlockCategory(value: string): value is DnsBlockCategory {
    return (DNS_BLOCK_CATEGORIES as readonly string[]).includes(value);
}

/**
 * Where the category domain sets come from. Today the lists are files on disk;
 * an implementation backed by an upstream API can replace it without touching
 * anything else, as long as it returns the same per-category sets.
 */
export interface BlocklistSource {
    /** All domains in a category. */
    getCategoryDomains(
        category: DnsBlockCategory
    ): Promise<ReadonlySet<string>>;
    /**
     * A token that changes whenever the underlying lists change. Used to
     * invalidate caches and to decide when to push new lists to clients.
     */
    getVersion(): Promise<string>;
}

// File layout, mirroring the layout the lists are published in:
//   <dir>/hosts                       base list, the "ads" category
//   <dir>/alternates/<name>/hosts     base list plus one extra category
// An alternates file contains the base list too, so a category is that file
// minus the base list.
const CATEGORY_DIRS: Record<Exclude<DnsBlockCategory, "ads">, string> = {
    fakenews: "fakenews",
    gambling: "gambling",
    adult: "porn",
    social: "social"
};

type CachedSet = { mtimeMs: number; domains: Set<string> };

export class FileBlocklistSource implements BlocklistSource {
    private fileCache = new Map<string, CachedSet>();
    private categoryCache = new Map<
        DnsBlockCategory,
        { key: string; domains: Set<string> }
    >();

    constructor(private readonly dirOverride?: string) {}

    private get dir(): string {
        return (
            this.dirOverride ??
            config.getRawConfig().server.dns_blocklists_path ??
            path.join(APP_PATH, "blocklists")
        );
    }

    private basePath(): string {
        return path.join(this.dir, "hosts");
    }

    private categoryPath(category: DnsBlockCategory): string {
        if (category === "ads") return this.basePath();
        return path.join(
            this.dir,
            "alternates",
            CATEGORY_DIRS[category],
            "hosts"
        );
    }

    private async mtime(file: string): Promise<number | null> {
        try {
            return (await fs.stat(file)).mtimeMs;
        } catch {
            return null;
        }
    }

    private async readFile(file: string): Promise<Set<string>> {
        const mtimeMs = await this.mtime(file);
        if (mtimeMs === null) return new Set();

        const cached = this.fileCache.get(file);
        if (cached && cached.mtimeMs === mtimeMs) return cached.domains;

        const domains = parseDomains(await fs.readFile(file, "utf-8"));
        this.fileCache.set(file, { mtimeMs, domains });
        logger.info(
            `Loaded ${domains.size} domains from blocklist file ${file}`
        );
        return domains;
    }

    async getCategoryDomains(
        category: DnsBlockCategory
    ): Promise<ReadonlySet<string>> {
        const file = this.categoryPath(category);
        const baseFile = this.basePath();
        const key =
            category === "ads"
                ? `${await this.mtime(file)}`
                : `${await this.mtime(file)}:${await this.mtime(baseFile)}`;

        const cached = this.categoryCache.get(category);
        if (cached && cached.key === key) return cached.domains;

        let domains: Set<string>;
        try {
            const all = await this.readFile(file);
            if (category === "ads") {
                domains = new Set(all);
            } else {
                const base = await this.readFile(baseFile);
                domains = new Set();
                for (const d of all) {
                    if (!base.has(d)) domains.add(d);
                }
            }
        } catch (error) {
            logger.error(
                `Failed to read DNS blocklist for category ${category}:`,
                error
            );
            return cached?.domains ?? new Set();
        }

        this.categoryCache.set(category, { key, domains });
        return domains;
    }

    async getVersion(): Promise<string> {
        const parts: string[] = [];
        for (const category of DNS_BLOCK_CATEGORIES) {
            parts.push(
                `${category}=${await this.mtime(this.categoryPath(category))}`
            );
        }
        return parts.join(",");
    }
}

let source: BlocklistSource = new FileBlocklistSource();

export function getBlocklistSource(): BlocklistSource {
    return source;
}

/** Replaces the source, for tests and for a future upstream-backed source. */
export function setBlocklistSource(next: BlocklistSource): void {
    source = next;
}
