export function createCname(
    domainId: string,
    baseDomain: string
): { baseDomain: string; value: string }[] {
    throw new Error("Creating CNAME records is not supported in this build");
}

export function createNs(): string[] {
    throw new Error("Creating NS records is not supported in this build");
}
