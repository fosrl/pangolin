export function areArraysEqual(a: string[], b: string[]) {
    if (a.length !== b.length) {
        return false;
    }
    const setB = new Set(b);
    return a.every((value) => setB.has(value));
}
