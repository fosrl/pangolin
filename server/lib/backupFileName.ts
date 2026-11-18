export function formatBackupTimestamp(date: Date = new Date()): string {
    const pad = (value: number): string => String(value).padStart(2, "0");

    const datePart = [
        date.getFullYear(),
        pad(date.getMonth() + 1),
        pad(date.getDate())
    ].join("-");

    const timePart = [
        pad(date.getHours()),
        pad(date.getMinutes()),
        pad(date.getSeconds())
    ].join("-");

    return `${datePart}_${timePart}`;
}

/**
 * Builds the full database backup file name, including timestamp and optional version tag.
 *
 * When a migration version is provided, the filename includes `_v<version>`,
 * preventing collisions between multiple migrations running in the same second and making it easy
 * to identify the migration state contained in the backup.
 *
 * @param version Optional migration version being run.
 * @param date The moment the backup is being taken. Defaults to now.
 * @returns A filename of the form `db_YYYY-MM-DD_HH-MM-SS_v<version>.sqlite` or `db_YYYY-MM-DD_HH-MM-SS.sqlite`.
 */
export function formatBackupFileName(
    version?: string,
    date: Date = new Date()
): string {
    const timestamp = formatBackupTimestamp(date);
    if (version) {
        const versionTag = version.startsWith("v") ? version : `v${version}`;
        return `db_${timestamp}_${versionTag}.sqlite`;
    }
    return `db_${timestamp}.sqlite`;
}
