"use client";

import { Badge } from "@app/components/ui/badge";
import { InfoPopup } from "@app/components/ui/info-popup";
import {
    detectRoleMappingConfig,
    extractReturnedRoleNames,
    RoleMappingMode,
    unwrapRoleMapping
} from "@app/lib/idpRoleMapping";
import { Code, ListChecks, Sparkles, Tags } from "lucide-react";
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";

const MAX_INLINE_ROLES = 3;

const MODE_ICONS: Record<RoleMappingMode, typeof Code> = {
    fixedRoles: Tags,
    mappingBuilder: ListChecks,
    rawExpression: Code
};

const MODE_LABEL_KEYS: Record<RoleMappingMode, string> = {
    fixedRoles: "roleMappingModeFixedRoles",
    mappingBuilder: "roleMappingModeMappingBuilder",
    rawExpression: "roleMappingModeRawExpression"
};

function RoleBadges({ roleNames }: { roleNames: string[] }) {
    const shown = roleNames.slice(0, MAX_INLINE_ROLES);
    const hidden = roleNames.length - shown.length;
    return (
        <>
            {shown.map((name) => (
                <Badge key={name} variant="secondary">
                    {name}
                </Badge>
            ))}
            {hidden > 0 && <Badge variant="outline">+{hidden}</Badge>}
        </>
    );
}

function CodeChip({ children }: { children: string }) {
    return (
        <code className="max-w-56 truncate rounded bg-muted px-1.5 py-0.5 font-mono text-xs">
            {children}
        </code>
    );
}

function CodeBlock({ children }: { children: string }) {
    return (
        <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-all rounded bg-muted p-2 font-mono text-xs">
            {children}
        </pre>
    );
}

/** Mode, then the roles the mapping returns. Hover for the rules or the full expression. */
export function RoleMappingSummary({
    roleMapping,
    createMissingRoles
}: {
    roleMapping: string | null | undefined;
    createMissingRoles?: boolean;
}) {
    const t = useTranslations();

    if (!roleMapping?.trim()) {
        return <span className="text-muted-foreground">-</span>;
    }

    const config = detectRoleMappingConfig(roleMapping);
    const ModeIcon = MODE_ICONS[config.mode];

    let roleNames: string[];
    let details: ReactNode;
    switch (config.mode) {
        case "fixedRoles":
            roleNames = config.fixedRoleNames;
            details = (
                <div className="space-y-2">
                    <p className="text-xs font-medium text-muted-foreground">
                        {t("roleMappingFixedRolesDescriptionSameForAll")}
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                        {roleNames.map((name) => (
                            <Badge key={name} variant="secondary">
                                {name}
                            </Badge>
                        ))}
                    </div>
                </div>
            );
            break;
        case "mappingBuilder": {
            const { rules, claimPath } = config.mappingBuilder;
            roleNames = [...new Set(rules.flatMap((rule) => rule.roleNames))];
            details = (
                <div className="space-y-2">
                    <p className="text-xs font-medium text-muted-foreground">
                        {t("roleMappingSummaryRules", { claimPath })}
                    </p>
                    <ul className="space-y-1.5">
                        {rules.map((rule, i) => (
                            <li
                                key={rule.id ?? i}
                                className="flex flex-wrap items-center gap-1.5 text-sm"
                            >
                                <CodeChip>{rule.matchValue || "-"}</CodeChip>
                                <span className="text-muted-foreground">→</span>
                                <RoleBadges roleNames={rule.roleNames} />
                            </li>
                        ))}
                    </ul>
                </div>
            );
            break;
        }
        case "rawExpression": {
            const expression =
                unwrapRoleMapping(roleMapping).evaluationExpression;
            roleNames = extractReturnedRoleNames(expression);
            details = (
                <div className="space-y-2">
                    <CodeBlock>{expression}</CodeBlock>
                    {roleNames.length > 0 && (
                        <div className="space-y-1.5">
                            <p className="text-xs font-medium text-muted-foreground">
                                {t("roleMappingSummaryPossibleRoles")}
                            </p>
                            <div className="flex flex-wrap gap-1.5">
                                {roleNames.map((name) => (
                                    <Badge key={name} variant="secondary">
                                        {name}
                                    </Badge>
                                ))}
                            </div>
                        </div>
                    )}
                </div>
            );
            break;
        }
    }

    const missingRolesNote = createMissingRoles && (
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Sparkles className="h-3.5 w-3.5" />
            {t("roleMappingSummaryCreatesMissingRoles")}
        </p>
    );

    const summary = (
        <div className="flex cursor-default flex-wrap items-center gap-1.5">
            <Badge variant="outline" className="gap-1">
                <ModeIcon className="h-3 w-3" />
                {t(MODE_LABEL_KEYS[config.mode])}
            </Badge>
            {roleNames.length > 0 ? (
                <RoleBadges roleNames={roleNames} />
            ) : config.mode === "rawExpression" ? (
                <CodeChip>
                    {unwrapRoleMapping(roleMapping).evaluationExpression}
                </CodeChip>
            ) : (
                <span className="text-xs text-muted-foreground">
                    {t("roleMappingSummaryNoRoles")}
                </span>
            )}
            {createMissingRoles && (
                <Sparkles
                    className="h-3.5 w-3.5 text-muted-foreground"
                    aria-label={t("roleMappingSummaryCreatesMissingRoles")}
                />
            )}
        </div>
    );

    // the whole summary opens the details on hover, no separate icon
    return (
        <InfoPopup trigger={summary}>
            <div className="space-y-3">
                {details}
                {missingRolesNote}
            </div>
        </InfoPopup>
    );
}

/** Org mapping expression as a code chip, full expression on hover when it's cut. */
export function OrgMappingSummary({
    orgMapping
}: {
    orgMapping: string | null | undefined;
}) {
    const expression = orgMapping?.trim();
    if (!expression) {
        return <span className="text-muted-foreground">-</span>;
    }
    if (expression.length <= 40) {
        return <CodeChip>{expression}</CodeChip>;
    }
    return (
        <InfoPopup
            trigger={
                <div className="flex cursor-default">
                    <CodeChip>{expression}</CodeChip>
                </div>
            }
        >
            <CodeBlock>{expression}</CodeBlock>
        </InfoPopup>
    );
}

/** One row per method when JIT and sync mappings are configured separately. */
export function JitSyncRows({
    linked,
    jit,
    sync
}: {
    linked: boolean;
    jit: ReactNode;
    sync: ReactNode;
}) {
    const t = useTranslations();
    if (linked) {
        return <>{jit}</>;
    }
    return (
        <div className="grid grid-cols-[auto_1fr] items-center gap-x-2 gap-y-1.5">
            <span className="text-xs text-muted-foreground">
                {t("idpMappingsJitShort")}
            </span>
            {jit}
            <span className="text-xs text-muted-foreground">
                {t("idpMappingsSyncShort")}
            </span>
            {sync}
        </div>
    );
}
