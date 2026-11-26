"use client";

import { Badge } from "@app/components/ui/badge";
import { Input } from "@app/components/ui/input";
import { Label } from "@app/components/ui/label";
import { Textarea } from "@app/components/ui/textarea";
import {
    evaluateOrgMapping,
    evaluateRoleMappingExpression
} from "@app/lib/idpMappingEval";
import { unwrapRoleMapping } from "@app/lib/idpRoleMapping";
import { useTranslations } from "next-intl";
import { useDeferredValue, useId, useMemo, useState } from "react";

type IdpMappingPlaygroundProps = {
    /** Claims to start with, e.g. from the last test login. */
    claims?: Record<string, unknown> | null;
    /** Org mapping to start with (may contain `{{orgId}}`). */
    orgMapping?: string | null;
    /** Stored or compiled role mapping to start with. */
    roleMapping?: string | null;
    /** Org the `{{orgId}}` placeholder resolves to. Editable when omitted. */
    orgId?: string;
    /** Roles of the org, to tell which mapped roles exist. */
    roles?: { name: string }[];
    /** Hide the org mapping (org IdPs: the org is fixed). */
    showOrgMapping?: boolean;
};

function formatResult(value: unknown): string {
    return value === undefined ? "undefined" : JSON.stringify(value, null, 2);
}

/** Evaluates org and role mapping expressions against claims, live, in the browser. */
export default function IdpMappingPlayground({
    claims,
    orgMapping: initialOrgMapping,
    roleMapping: initialRoleMapping,
    orgId: fixedOrgId,
    roles,
    showOrgMapping = true
}: IdpMappingPlaygroundProps) {
    const t = useTranslations();
    const id = useId();

    const [claimsText, setClaimsText] = useState(() =>
        claims ? JSON.stringify(claims, null, 2) : ""
    );
    const [orgMapping, setOrgMapping] = useState(initialOrgMapping ?? "");
    const [roleMapping, setRoleMapping] = useState(
        () => unwrapRoleMapping(initialRoleMapping).evaluationExpression
    );
    const [orgIdInput, setOrgIdInput] = useState(fixedOrgId ?? "");

    const deferredClaimsText = useDeferredValue(claimsText);
    const deferredOrgMapping = useDeferredValue(orgMapping);
    const deferredRoleMapping = useDeferredValue(roleMapping);
    const orgId = fixedOrgId ?? orgIdInput;

    const parsedClaims = useMemo(() => {
        if (!deferredClaimsText.trim()) {
            return { value: null, error: null };
        }
        try {
            return { value: JSON.parse(deferredClaimsText), error: null };
        } catch (e) {
            return {
                value: null,
                error: e instanceof Error ? e.message : String(e)
            };
        }
    }, [deferredClaimsText]);

    const orgEvaluation = useMemo(
        () =>
            parsedClaims.value !== null && showOrgMapping
                ? evaluateOrgMapping(
                      parsedClaims.value,
                      deferredOrgMapping,
                      orgId
                  )
                : null,
        [parsedClaims.value, deferredOrgMapping, orgId, showOrgMapping]
    );
    const roleEvaluation = useMemo(
        () =>
            parsedClaims.value !== null
                ? evaluateRoleMappingExpression(
                      parsedClaims.value,
                      deferredRoleMapping
                  )
                : null,
        [parsedClaims.value, deferredRoleMapping]
    );

    const roleNamesInOrg = roles ? new Set(roles.map((r) => r.name)) : null;

    return (
        <div className="space-y-5">
            <div className="space-y-2">
                <Label htmlFor={`${id}-claims`}>
                    {t("idpPlaygroundClaims")}
                </Label>
                <Textarea
                    id={`${id}-claims`}
                    className="font-mono text-xs min-h-48"
                    placeholder={t("idpPlaygroundClaimsPlaceholder")}
                    value={claimsText}
                    onChange={(e) => setClaimsText(e.target.value)}
                    spellCheck={false}
                />
                {parsedClaims.error ? (
                    <p className="text-sm text-destructive">
                        {t("idpPlaygroundInvalidJson", {
                            error: parsedClaims.error
                        })}
                    </p>
                ) : (
                    !claimsText.trim() && (
                        <p className="text-sm text-muted-foreground">
                            {t("idpPlaygroundClaimsHint")}
                        </p>
                    )
                )}
            </div>

            {showOrgMapping && (
                <div className="space-y-2">
                    <Label htmlFor={`${id}-org`}>{t("orgMapping")}</Label>
                    <Input
                        id={`${id}-org`}
                        className="font-mono"
                        placeholder="contains(groups, 'admins')"
                        value={orgMapping}
                        onChange={(e) => setOrgMapping(e.target.value)}
                    />
                    {fixedOrgId === undefined &&
                        orgMapping.includes("{{orgId}}") && (
                            <Input
                                aria-label={t("idpPlaygroundOrgId")}
                                placeholder={t("idpPlaygroundOrgId")}
                                value={orgIdInput}
                                onChange={(e) => setOrgIdInput(e.target.value)}
                            />
                        )}
                    {orgEvaluation && (
                        <EvaluationOutput
                            error={orgEvaluation.error}
                            result={orgEvaluation.result}
                        >
                            <Badge
                                variant={orgEvaluation.passed ? "green" : "red"}
                            >
                                {orgEvaluation.passed
                                    ? t("idpPlaygroundOrgMatched")
                                    : t("idpPlaygroundOrgNotMatched")}
                            </Badge>
                        </EvaluationOutput>
                    )}
                </div>
            )}

            <div className="space-y-2">
                <Label htmlFor={`${id}-role`}>{t("roleMapping")}</Label>
                <Input
                    id={`${id}-role`}
                    className="font-mono"
                    placeholder="contains(groups, 'admins') && 'Admin' || 'Member'"
                    value={roleMapping}
                    onChange={(e) => setRoleMapping(e.target.value)}
                />
                {roleEvaluation && (
                    <EvaluationOutput
                        error={roleEvaluation.error}
                        result={roleEvaluation.result}
                    >
                        {roleEvaluation.roleNames.length === 0 ? (
                            <Badge variant="red">
                                {t("idpPlaygroundNoRoles")}
                            </Badge>
                        ) : (
                            roleEvaluation.roleNames.map((name) => {
                                const missing =
                                    roleNamesInOrg !== null &&
                                    !roleNamesInOrg.has(name);
                                return (
                                    <Badge
                                        key={name}
                                        variant={missing ? "yellow" : "green"}
                                        title={
                                            missing
                                                ? t("idpPlaygroundRoleMissing")
                                                : undefined
                                        }
                                    >
                                        {name}
                                    </Badge>
                                );
                            })
                        )}
                    </EvaluationOutput>
                )}
            </div>
        </div>
    );
}

function EvaluationOutput({
    error,
    result,
    children
}: {
    error?: string;
    result: unknown;
    children: React.ReactNode;
}) {
    const t = useTranslations();

    if (error) {
        return (
            <p className="text-sm text-destructive">
                {t("idpPlaygroundExpressionError", { error })}
            </p>
        );
    }

    return (
        <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">{children}</div>
            <div className="space-y-1">
                <p className="text-xs text-muted-foreground">
                    {t("idpPlaygroundResult")}
                </p>
                <pre className="max-h-40 overflow-auto rounded-md bg-muted px-3 py-2 font-mono text-xs">
                    {formatResult(result)}
                </pre>
            </div>
        </div>
    );
}
