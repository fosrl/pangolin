"use client";

import CopyTextBox from "@app/components/CopyTextBox";
import {
    InfoSection,
    InfoSectionContent,
    InfoSections,
    InfoSectionTitle
} from "@app/components/InfoSection";
import {
    SettingsSubsectionDescription,
    SettingsSubsectionHeader,
    SettingsSubsectionTitle
} from "@app/components/Settings";
import Timestamp from "@app/components/Timestamp";
import { Alert, AlertDescription } from "@app/components/ui/alert";
import { Badge } from "@app/components/ui/badge";
import { Button } from "@app/components/ui/button";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow
} from "@app/components/ui/table";
import type {
    OidcTestOrgResult,
    OidcTestResult,
    OidcTestWarning
} from "@server/lib/idp/previewIdpLogin";
import { useTranslations } from "next-intl";

const STATUS_VARIANT: Record<
    OidcTestOrgResult["status"],
    "green" | "yellow" | "red" | "secondary"
> = {
    matched: "green",
    noRoleMapping: "secondary",
    expressionError: "red",
    orgMappingMismatch: "secondary",
    noRoleNames: "yellow",
    noMatchingRoles: "yellow"
};

const STATUS_LABEL: Record<OidcTestOrgResult["status"], string> = {
    matched: "idpTestStatusMatched",
    noRoleMapping: "idpTestStatusNoRoleMapping",
    expressionError: "idpTestStatusExpressionError",
    orgMappingMismatch: "idpTestStatusOrgMappingMismatch",
    noRoleNames: "idpTestStatusNoRoleNames",
    noMatchingRoles: "idpTestStatusNoMatchingRoles"
};

const CHANGE_LABEL: Record<OidcTestOrgResult["change"], string> = {
    add: "idpTestChangeAdd",
    updateRoles: "idpTestChangeUpdateRoles",
    remove: "idpTestChangeRemove",
    keptManual: "idpTestChangeKeptManual",
    none: "idpTestChangeNone"
};

type IdpTestResultViewProps = {
    result: OidcTestResult;
    /** Shows a button per org to load its mappings in the playground. */
    onTryMappings?: (orgId: string) => void;
};

/** What a login with these claims does: identity, per-org mappings, claims. */
export default function IdpTestResultView({
    result,
    onTryMappings
}: IdpTestResultViewProps) {
    const t = useTranslations();

    return (
        <div className="space-y-5">
            <TestSummary result={result} />

            {result.warnings.length > 0 && (
                <Alert variant="warning">
                    <AlertDescription>
                        <ul className="list-disc space-y-1 pl-5">
                            {result.warnings.map((w, i) => (
                                <li key={i}>
                                    <WarningText warning={w} />
                                </li>
                            ))}
                        </ul>
                    </AlertDescription>
                </Alert>
            )}

            <div>
                <SettingsSubsectionHeader>
                    <SettingsSubsectionTitle>
                        {t("idpTestIdentityTitle")}
                    </SettingsSubsectionTitle>
                    <SettingsSubsectionDescription>
                        {t("idpTestIdentityDescription")}
                    </SettingsSubsectionDescription>
                </SettingsSubsectionHeader>
                <InfoSections cols={3} size="sm">
                    <IdentityField
                        label={t("idpTestIdentifier")}
                        value={result.identity.identifier}
                        path={result.identity.identifierPath}
                    />
                    <IdentityField
                        label={t("email")}
                        value={result.identity.email}
                        path={result.identity.emailPath}
                    />
                    <IdentityField
                        label={t("name")}
                        value={result.identity.name}
                        path={result.identity.namePath}
                    />
                </InfoSections>
            </div>

            <div>
                <SettingsSubsectionHeader>
                    <SettingsSubsectionTitle>
                        {t("idpTestOrgsTitle")}
                    </SettingsSubsectionTitle>
                    <SettingsSubsectionDescription>
                        {result.autoProvision
                            ? t("idpTestOrgsDescription")
                            : t("idpTestAutoProvisionOff")}
                    </SettingsSubsectionDescription>
                </SettingsSubsectionHeader>
                {result.autoProvision && (
                    <OrgResultsTable
                        orgs={result.orgs}
                        onTest={onTryMappings}
                    />
                )}
            </div>

            <div>
                <SettingsSubsectionHeader>
                    <SettingsSubsectionTitle>
                        {t("idpTestClaimsTitle")}
                    </SettingsSubsectionTitle>
                    <SettingsSubsectionDescription>
                        {result.enrichedClaimKeys.length > 0
                            ? t("idpTestClaimsEnriched", {
                                  keys: result.enrichedClaimKeys.join(", ")
                              })
                            : t("idpTestClaimsDescription")}
                    </SettingsSubsectionDescription>
                </SettingsSubsectionHeader>
                <CopyTextBox
                    text={JSON.stringify(result.claims, null, 2)}
                    wrapText
                />
            </div>
        </div>
    );
}

function TestSummary({ result }: { result: OidcTestResult }) {
    const t = useTranslations();

    return (
        <InfoSections cols={3} size="sm">
            <InfoSection>
                <InfoSectionTitle>{t("idpTestLoginOutcome")}</InfoSectionTitle>
                <InfoSectionContent>
                    {result.loginOutcome === null ? (
                        <span className="text-muted-foreground">
                            {t("idpTestLoginOutcomeScoped")}
                        </span>
                    ) : (
                        <Badge
                            variant={
                                result.loginOutcome === "allowed"
                                    ? "green"
                                    : "red"
                            }
                        >
                            {result.loginOutcome === "allowed"
                                ? t("idpTestLoginAllowed")
                                : t("idpTestLoginDenied")}
                        </Badge>
                    )}
                </InfoSectionContent>
            </InfoSection>
            <InfoSection>
                <InfoSectionTitle>{t("user")}</InfoSectionTitle>
                <InfoSectionContent>
                    {result.existingUser
                        ? t("idpTestExistingUser")
                        : result.loginOutcome === "denied"
                          ? t("idpTestUserNotCreated")
                          : t("idpTestNewUser")}
                </InfoSectionContent>
            </InfoSection>
            <InfoSection>
                <InfoSectionTitle>{t("idpTestTestedAt")}</InfoSectionTitle>
                <InfoSectionContent>
                    <Timestamp value={result.testedAt} />
                </InfoSectionContent>
            </InfoSection>
        </InfoSections>
    );
}

function IdentityField({
    label,
    value,
    path
}: {
    label: string;
    value: string | null;
    path: string | null;
}) {
    const t = useTranslations();

    return (
        <InfoSection>
            <InfoSectionTitle>{label}</InfoSectionTitle>
            <InfoSectionContent>
                <div>
                    {value ?? <span className="text-muted-foreground">-</span>}
                </div>
                <div className="text-xs text-muted-foreground font-mono">
                    {path ?? t("idpTestPathNotSet")}
                </div>
            </InfoSectionContent>
        </InfoSection>
    );
}

function WarningText({ warning }: { warning: OidcTestWarning }) {
    const t = useTranslations();

    switch (warning.code) {
        case "identifierNotFound":
            return t("idpTestWarningIdentifierNotFound", {
                path: warning.path
            });
        case "identifierPathError":
            return t("idpTestWarningIdentifierPathError", {
                path: warning.path,
                error: warning.error
            });
        case "emailNotFound":
            return t("idpTestWarningEmailNotFound", { path: warning.path });
        case "nameNotFound":
            return t("idpTestWarningNameNotFound", { path: warning.path });
        case "noGroupsClaim":
            return t("idpTestWarningNoGroupsClaim");
    }
}

function OrgResultsTable({
    orgs,
    onTest
}: {
    orgs: OidcTestOrgResult[];
    onTest?: (orgId: string) => void;
}) {
    const t = useTranslations();

    if (orgs.length === 0) {
        return (
            <p className="text-sm text-muted-foreground">
                {t("idpTestNoOrgs")}
            </p>
        );
    }

    return (
        <div className="overflow-x-auto rounded-md border">
            <Table>
                <TableHeader>
                    <TableRow>
                        <TableHead className="px-3">
                            {t("organization")}
                        </TableHead>
                        <TableHead className="px-3">
                            {t("orgMapping")}
                        </TableHead>
                        <TableHead className="px-3">
                            {t("roleMapping")}
                        </TableHead>
                        <TableHead className="px-3">{t("status")}</TableHead>
                        <TableHead className="px-3">
                            {t("idpTestChange")}
                        </TableHead>
                        {onTest && <TableHead className="px-3" />}
                    </TableRow>
                </TableHeader>
                <TableBody>
                    {orgs.map((org) => (
                        <TableRow key={org.orgId} className="align-top">
                            <TableCell className="px-3 font-medium">
                                {org.orgName}
                            </TableCell>
                            <TableCell className="px-3">
                                {org.trace?.orgMapping ? (
                                    <ExpressionResult
                                        expression={
                                            org.trace.orgMapping.expression
                                        }
                                        result={org.trace.orgMapping.result}
                                        error={org.trace.orgMapping.error}
                                        source={org.orgMappingSource}
                                    />
                                ) : (
                                    <span className="text-sm text-muted-foreground">
                                        {t("idpTestNoOrgMapping")}
                                    </span>
                                )}
                            </TableCell>
                            <TableCell className="px-3">
                                {org.trace?.roleMapping ? (
                                    <div className="space-y-2">
                                        <ExpressionResult
                                            expression={
                                                org.trace.roleMapping.expression
                                            }
                                            result={
                                                org.trace.roleMapping.result
                                            }
                                            error={org.trace.roleMapping.error}
                                            source={org.roleMappingSource}
                                        />
                                        <RoleBadges org={org} />
                                    </div>
                                ) : (
                                    <span className="text-sm text-muted-foreground">
                                        {org.status === "noRoleMapping"
                                            ? t("idpTestNoRoleMapping")
                                            : "-"}
                                    </span>
                                )}
                            </TableCell>
                            <TableCell className="px-3">
                                <Badge variant={STATUS_VARIANT[org.status]}>
                                    {t(STATUS_LABEL[org.status])}
                                </Badge>
                            </TableCell>
                            <TableCell className="px-3 text-sm">
                                <div>{t(CHANGE_LABEL[org.change])}</div>
                                {org.currentRoleNames.length > 0 && (
                                    <div className="text-xs text-muted-foreground">
                                        {t("idpTestCurrentRoles", {
                                            roles: org.currentRoleNames.join(
                                                ", "
                                            )
                                        })}
                                    </div>
                                )}
                            </TableCell>
                            {onTest && (
                                <TableCell className="px-3 text-right">
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        onClick={() => onTest(org.orgId)}
                                    >
                                        {t("idpTestOpenInPlayground")}
                                    </Button>
                                </TableCell>
                            )}
                        </TableRow>
                    ))}
                </TableBody>
            </Table>
        </div>
    );
}

function ExpressionResult({
    expression,
    result,
    error,
    source
}: {
    expression: string;
    result: unknown;
    error?: string;
    source: "org" | "default" | null;
}) {
    const t = useTranslations();

    return (
        <div className="space-y-1 max-w-xs">
            <code className="block break-all text-xs">{expression}</code>
            {source === "default" && (
                <div className="text-xs text-muted-foreground">
                    {t("idpTestDefaultMapping")}
                </div>
            )}
            {error ? (
                <div className="text-xs text-destructive">{error}</div>
            ) : (
                <div className="text-xs text-muted-foreground break-all">
                    {t("idpTestReturned", {
                        result:
                            result === undefined
                                ? "undefined"
                                : JSON.stringify(result)
                    })}
                </div>
            )}
        </div>
    );
}

function RoleBadges({ org }: { org: OidcTestOrgResult }) {
    const t = useTranslations();

    if (org.status === "noMatchingRoles") {
        return (
            <div className="flex flex-wrap gap-1">
                {org.roleNames.map((name) => (
                    <Badge
                        key={name}
                        variant="yellow"
                        title={t("idpPlaygroundRoleMissing")}
                    >
                        {name}
                    </Badge>
                ))}
            </div>
        );
    }

    return (
        <div className="flex flex-wrap gap-1">
            {org.matchedRoleNames.map((name) => (
                <Badge key={name} variant="green">
                    {name}
                </Badge>
            ))}
            {org.missingRoleNames.map((name) => (
                <Badge
                    key={name}
                    variant="yellow"
                    title={t("idpTestRoleWillBeCreated")}
                >
                    {t("idpTestRoleCreated", { role: name })}
                </Badge>
            ))}
        </div>
    );
}
