import { gzipSync, gunzipSync } from "zlib";

/**
 * Gzip a string and return it as base64 so it can be stored in a TEXT column.
 */
export function compressText(value: string): string {
    return gzipSync(Buffer.from(value, "utf8")).toString("base64");
}

/**
 * Reverse of compressText - base64-decode and gunzip back to the original string.
 */
export function decompressText(value: string): string {
    return gunzipSync(Buffer.from(value, "base64")).toString("utf8");
}
