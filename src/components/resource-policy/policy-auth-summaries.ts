type SummaryParams = {
    t: (key: string, values?: Record<string, string | number>) => string;
};

type SsoSummaryParams = SummaryParams & {
    idpName?: string;
    userCount: number;
    roleCount: number;
};

export function getSsoSummary({
    t,
    idpName,
    userCount,
    roleCount
}: SsoSummaryParams) {
    const idp = idpName ?? t("policyAuthSsoDefaultIdp");
    return t("policyAuthSsoSummary", {
        idp,
        users: userCount,
        roles: roleCount
    });
}

export function getPasscodeSummary({ t }: SummaryParams) {
    return t("policyAuthPasscodeSummary");
}

export function getPincodeSummary({ t }: SummaryParams) {
    return t("policyAuthPincodeSummary");
}

export function getEmailWhitelistSummary({
    t,
    count
}: SummaryParams & { count: number }) {
    return t("policyAuthEmailSummary", { count });
}

export function getHeaderAuthSummary({
    t,
    headerName
}: SummaryParams & { headerName: string }) {
    return headerName || t("policyAuthHeaderAuthSummary");
}
