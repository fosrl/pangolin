export async function getOrgTierData(
    orgId: string
): Promise<{ tier: string | null; active: boolean }> {
    const tier = null;
    const active = false;

    return { tier, active };
}
