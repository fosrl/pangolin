// drizzle-zod gives every integer column the numeric range of its database type
// (for example +/-2147483648). Those bounds are noise in API docs, so drop them.
const NOISE = new Set([
    2147483647, -2147483648, 9007199254740991, -9007199254740991
]);

export function stripIntegerBounds<T>(node: T): T {
    if (Array.isArray(node)) {
        node.forEach((n) => stripIntegerBounds(n));
    } else if (node && typeof node === "object") {
        const obj = node as Record<string, unknown>;
        for (const key of ["minimum", "maximum"]) {
            const v = obj[key];
            if (typeof v === "number" && NOISE.has(v)) {
                delete obj[key];
            }
        }
        Object.values(obj).forEach((n) => stripIntegerBounds(n));
    }
    return node;
}
