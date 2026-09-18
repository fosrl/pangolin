/**
 * Builds the timestamp segment of a database backup file name.
 *
 * `Date#getMonth` is zero-indexed, so building this inline produced names like
 * `db_2026-8-12_...` for a backup taken on 12 September 2026. Every field is
 * also zero-padded, which keeps the names unambiguous and makes them sort
 * lexicographically in the order they were taken.
 *
 * @param date The moment the backup is being taken. Defaults to now.
 * @returns A timestamp of the form `YYYY-MM-DD_HH-MM-SS`.
 */
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
