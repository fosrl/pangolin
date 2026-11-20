"use client";

import {
    Credenza,
    CredenzaBody,
    CredenzaClose,
    CredenzaContent,
    CredenzaDescription,
    CredenzaFooter,
    CredenzaHeader,
    CredenzaTitle
} from "@app/components/Credenza";
import IdpMappingPlayground from "@app/components/idp/IdpMappingPlayground";
import { Button } from "@app/components/ui/button";
import {
    compileRoleMappingExpression,
    type RoleMappingConfig
} from "@app/lib/idpRoleMapping";
import { useEnvContext } from "@app/hooks/useEnvContext";
import { createApiClient } from "@app/lib/api";
import type { GetLatestIdpTestResultResponse } from "@server/routers/idp";
import { AxiosResponse } from "axios";
import { FlaskConical } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { useWatch, type Control } from "react-hook-form";

type IdpMappingTestButtonProps = {
    /**
     * `/idp/:idpId` or `/org/:orgId/idp/:idpId`: prefills the claims of the
     * IdP's latest completed test link. Omit on create pages.
     */
    testResultsApiBase?: string;
    /** Org the `{{orgId}}` placeholder resolves to. */
    orgId?: string;
    /** Roles of the org, to tell which mapped roles exist. */
    roles?: { name: string }[];
    /** The role mapping being edited (unsaved). */
    roleMapping: RoleMappingConfig;
    /** Form field holding the org mapping being edited. Omit for org IdPs. */
    orgMappingField?: { control: unknown; name: string };
};

/** Opens the mapping playground with the mappings being edited. */
export default function IdpMappingTestButton({
    orgMappingField,
    ...props
}: IdpMappingTestButtonProps) {
    if (orgMappingField) {
        return <WithOrgMapping {...props} orgMappingField={orgMappingField} />;
    }
    return <TestCredenza {...props} orgMapping={null} />;
}

function WithOrgMapping({
    orgMappingField,
    ...props
}: Omit<IdpMappingTestButtonProps, "orgMappingField"> & {
    orgMappingField: { control: unknown; name: string };
}) {
    const orgMapping = useWatch({
        control: orgMappingField.control as Control<any>,
        name: orgMappingField.name
    });
    return (
        <TestCredenza
            {...props}
            orgMapping={typeof orgMapping === "string" ? orgMapping : ""}
        />
    );
}

function TestCredenza({
    testResultsApiBase,
    orgId,
    roles,
    roleMapping,
    orgMapping
}: Omit<IdpMappingTestButtonProps, "orgMappingField"> & {
    /** `null` hides the org mapping. */
    orgMapping: string | null;
}) {
    const t = useTranslations();
    const { env } = useEnvContext();
    const api = createApiClient({ env });
    const [open, setOpen] = useState(false);
    // read when opening, so the playground starts from the current mappings
    const [snapshot, setSnapshot] = useState<{
        key: number;
        claims: Record<string, unknown> | null;
        roleMapping: string;
        orgMapping: string | null;
    } | null>(null);

    async function loadLatestClaims(): Promise<Record<string, unknown> | null> {
        if (!testResultsApiBase) {
            return null;
        }
        try {
            const res = await api.get<
                AxiosResponse<GetLatestIdpTestResultResponse>
            >(`${testResultsApiBase}/oidc/test-results/latest`);
            return res.data.data?.result?.claims ?? null;
        } catch {
            // the playground still works with pasted claims
            return null;
        }
    }

    async function openPlayground() {
        // read when opening, so the playground starts from the current mappings
        const base = {
            roleMapping: compileRoleMappingExpression(roleMapping),
            orgMapping
        };
        setSnapshot({ key: Date.now(), claims: null, ...base });
        setOpen(true);
        const claims = await loadLatestClaims();
        if (claims) {
            setSnapshot({ key: Date.now(), claims, ...base });
        }
    }

    return (
        <>
            <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={openPlayground}
            >
                <FlaskConical className="mr-2 h-4 w-4" />
                {t("idpPlaygroundTestMappings")}
            </Button>
            <Credenza open={open} onOpenChange={setOpen}>
                <CredenzaContent className="max-w-2xl sm:w-full">
                    <CredenzaHeader>
                        <CredenzaTitle>{t("idpPlaygroundTitle")}</CredenzaTitle>
                        <CredenzaDescription>
                            {snapshot?.claims
                                ? t("idpPlaygroundDescriptionLastTest")
                                : t("idpPlaygroundDescriptionNoTest")}
                        </CredenzaDescription>
                    </CredenzaHeader>
                    <CredenzaBody>
                        {snapshot && (
                            <IdpMappingPlayground
                                key={snapshot.key}
                                claims={snapshot.claims}
                                roleMapping={snapshot.roleMapping}
                                orgMapping={snapshot.orgMapping}
                                showOrgMapping={snapshot.orgMapping !== null}
                                orgId={orgId}
                                roles={orgId ? roles : undefined}
                            />
                        )}
                    </CredenzaBody>
                    <CredenzaFooter>
                        <CredenzaClose asChild>
                            <Button variant="outline">{t("close")}</Button>
                        </CredenzaClose>
                    </CredenzaFooter>
                </CredenzaContent>
            </Credenza>
        </>
    );
}
