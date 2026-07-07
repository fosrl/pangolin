export type TextImportFileType = "txt" | "csv";
export type TextImportMode = "override" | "append";

export function getTextImportFileType(file: File): TextImportFileType | null {
    const extension = file.name.split(".").pop()?.toLowerCase();
    if (extension === "txt" || extension === "csv") {
        return extension;
    }
    return null;
}

export function isSupportedTextImportFile(file: File): boolean {
    return getTextImportFileType(file) !== null;
}

export function readFileAsText(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (event) => {
            const result = event.target?.result;
            if (typeof result === "string") {
                resolve(result);
                return;
            }
            reject(new Error("Failed to read file"));
        };
        reader.onerror = () => reject(reader.error);
        reader.readAsText(file);
    });
}

function parseCsvFirstCell(row: string): string {
    const trimmed = row.trim();
    if (!trimmed) return "";

    if (trimmed.startsWith('"')) {
        let index = 1;
        let cell = "";
        while (index < trimmed.length) {
            if (trimmed[index] === '"') {
                if (trimmed[index + 1] === '"') {
                    cell += '"';
                    index += 2;
                    continue;
                }
                break;
            }
            cell += trimmed[index];
            index += 1;
        }
        return cell.trim();
    }

    const commaIndex = trimmed.indexOf(",");
    return (commaIndex === -1 ? trimmed : trimmed.slice(0, commaIndex)).trim();
}

export function parseCsvFirstColumn(
    content: string,
    skipHeader: boolean
): string[] {
    const rows = content.split(/\r?\n/).filter((line) => line.trim());
    const dataRows = skipHeader ? rows.slice(1) : rows;

    return dataRows.map(parseCsvFirstCell).filter(Boolean);
}

export function parseTextFileItems({
    content,
    fileType,
    skipHeader,
    parser
}: {
    content: string;
    fileType: TextImportFileType;
    skipHeader: boolean;
    parser: (value: string | undefined) => string[];
}): string[] {
    if (fileType === "csv") {
        return parseCsvFirstColumn(content, skipHeader);
    }

    return parser(content);
}

export function parsePreviewLines(value: string): string[] {
    return value
        .split(/\n/)
        .map((line) => line.trim())
        .filter(Boolean);
}

export function applyTextImport({
    currentValue,
    imported,
    mode,
    parser
}: {
    currentValue: string;
    imported: string[];
    mode: TextImportMode;
    parser: (value: string | undefined) => string[];
}): string {
    if (mode === "override") {
        return imported.join("\n");
    }

    const existing = parser(currentValue);
    return [...existing, ...imported].join("\n");
}
