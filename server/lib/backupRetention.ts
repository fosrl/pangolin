import fs from "fs";
import path from "path";

// Matches the names written by formatBackupFileName, old and new style:
// db_2026-0-11_3-42-57.sqlite, db_2026-11-21_12-23-04_v1.27.1.sqlite
const MIGRATION_BACKUP_PATTERN = /^db_[0-9][0-9_.v-]*\.sqlite$/;

/**
 * Reads MIGRATION_BACKUP_RETENTION: how many older migration backups to keep
 * next to the ones made by the current run. Unset, empty, 0 or an invalid
 * value keeps every backup, which is the existing behavior.
 */
export function getMigrationBackupRetention(
    env: Record<string, string | undefined> = process.env
): number {
    const raw = env.MIGRATION_BACKUP_RETENTION?.trim();
    if (!raw || !/^\d+$/.test(raw)) {
        return 0;
    }
    return Number(raw);
}

/**
 * Deletes old migration backups in backupsDir. The files in keepFiles (the
 * backups made by the current migration run) are never deleted. Of the other
 * backups, the `keep` newest are kept. keep <= 0 deletes nothing.
 *
 * Only files that look like migration backups are considered, so anything
 * else an admin stores in the folder is left alone.
 *
 * @returns The names of the deleted files.
 */
export function pruneMigrationBackups(
    backupsDir: string,
    keep: number,
    keepFiles: string[] = []
): string[] {
    if (!Number.isInteger(keep) || keep <= 0 || !fs.existsSync(backupsDir)) {
        return [];
    }

    const protectedNames = new Set(keepFiles);
    const candidates = fs
        .readdirSync(backupsDir, { withFileTypes: true })
        .filter(
            (entry) =>
                entry.isFile() &&
                MIGRATION_BACKUP_PATTERN.test(entry.name) &&
                !protectedNames.has(entry.name)
        )
        .map((entry) => ({
            name: entry.name,
            mtimeMs: fs.statSync(path.join(backupsDir, entry.name)).mtimeMs
        }))
        // newest first; the name breaks ties between files with the same mtime
        .sort((a, b) => b.mtimeMs - a.mtimeMs || b.name.localeCompare(a.name));

    const deleted: string[] = [];
    for (const file of candidates.slice(keep)) {
        try {
            fs.unlinkSync(path.join(backupsDir, file.name));
            deleted.push(file.name);
        } catch (error) {
            console.warn(
                `Could not delete old migration backup ${file.name}:`,
                error
            );
        }
    }
    return deleted;
}
