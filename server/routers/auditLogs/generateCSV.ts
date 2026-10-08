// Spreadsheet applications (Excel, LibreOffice, Google Sheets) evaluate a cell
// as a formula when it starts with one of these characters, even if the cell is
// quoted. Log exports carry attacker controlled text in every column, so a
// leading apostrophe is prefixed to force the cell to be read as literal text.
const FORMULA_PREFIX = /^[=+\-@\t\r]/;

// CRLF, CR and LF each terminate a record for at least one CSV parser, so a
// value containing them would otherwise spill across rows and forge new ones.
// Replacing them with a literal "\n" keeps every record on a single line.
const LINE_BREAKS = /\r\n|\r|\n/g;

/**
 * Render a single value as a CSV field that cannot be reinterpreted by a
 * spreadsheet application or reshape the surrounding file.
 */
function toCsvField(value: unknown): string {
    // Array#join renders null and undefined as an empty field, which is what the
    // export has always emitted for those columns, so keep that behaviour.
    if (value === null || value === undefined) {
        return "";
    }

    const text = String(value).replace(LINE_BREAKS, "\\n");

    // Quoting does not stop a spreadsheet from evaluating the unquoted value,
    // so the apostrophe has to be added before the field is escaped.
    const cell = FORMULA_PREFIX.test(text) ? `'${text}` : text;

    if (cell.includes(",") || cell.includes('"')) {
        return `"${cell.replace(/"/g, '""')}"`;
    }

    return cell;
}

export function generateCSV(data: any[]): string {
    if (data.length === 0) {
        return "orgId,action,actorType,timestamp,actor\n";
    }

    const headers = Object.keys(data[0]).map(toCsvField).join(",");
    const rows = data.map((row) =>
        Object.values(row).map(toCsvField).join(",")
    );

    return [headers, ...rows].join("\n");
}
