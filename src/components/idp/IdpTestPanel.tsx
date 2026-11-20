"use client";

import IdpMappingPlayground from "@app/components/idp/IdpMappingPlayground";
import IdpStoreLoginClaimsSection from "@app/components/idp/IdpStoreLoginClaimsSection";
import IdpTestLinksSection from "@app/components/idp/IdpTestLinksSection";
import IdpTestResultView from "@app/components/idp/IdpTestResultView";
import {
    SettingsContainer,
    SettingsSection,
    SettingsSectionBody,
    SettingsSectionDescription,
    SettingsSectionHeader,
    SettingsSectionTitle
} from "@app/components/Settings";
import type { OidcTestResult } from "@server/lib/idp/previewIdpLogin";
import { useTranslations } from "next-intl";
import { useState } from "react";

type IdpTestPanelProps = {
    idpId: number;
    /** Org IdP: only this org is evaluated. Omit for a global IdP. */
    orgId?: string;
    /** Current value of the IdP's "store login claims" setting. */
    storeLoginClaims: boolean;
};

/** The test link result being shown. */
type ResultView = { label: string | null; result: OidcTestResult };

/**
 * Test tab of an IdP: test links (for anyone, including yourself), the result
 * of a completed link, the mapping playground and the claims snapshot setting.
 */
export default function IdpTestPanel({
    idpId,
    orgId,
    storeLoginClaims
}: IdpTestPanelProps) {
    const t = useTranslations();
    const apiBase = orgId ? `/org/${orgId}/idp/${idpId}` : `/idp/${idpId}`;

    const [view, setView] = useState<ResultView | null>(null);
    // the org whose mappings are loaded in the playground
    const [playgroundOrgId, setPlaygroundOrgId] = useState<string | null>(null);

    const result = view?.result ?? null;

    const playgroundOrg =
        result?.orgs.find((o) => o.orgId === playgroundOrgId) ??
        result?.orgs[0];

    return (
        <SettingsContainer>
            <IdpTestLinksSection
                apiBase={apiBase}
                onViewResult={(next) => {
                    setView(next);
                    setPlaygroundOrgId(null);
                }}
            />

            {view && (
                <SettingsSection>
                    <SettingsSectionHeader>
                        <SettingsSectionTitle>
                            {view.label
                                ? t("idpTestLinkResultTitle", {
                                      label: view.label
                                  })
                                : t("idpTestResultTitle")}
                        </SettingsSectionTitle>
                        <SettingsSectionDescription>
                            {t("idpTestResultDescription")}
                        </SettingsSectionDescription>
                    </SettingsSectionHeader>
                    <SettingsSectionBody>
                        <IdpTestResultView
                            result={view.result}
                            onTryMappings={setPlaygroundOrgId}
                        />
                    </SettingsSectionBody>
                </SettingsSection>
            )}

            <SettingsSection>
                <SettingsSectionHeader>
                    <SettingsSectionTitle>
                        {t("idpPlaygroundTitle")}
                    </SettingsSectionTitle>
                    <SettingsSectionDescription>
                        {playgroundOrg
                            ? t("idpPlaygroundDescriptionOrg", {
                                  orgName: playgroundOrg.orgName
                              })
                            : t("idpPlaygroundDescription")}
                    </SettingsSectionDescription>
                </SettingsSectionHeader>
                <SettingsSectionBody>
                    <IdpMappingPlayground
                        // reset the editors when the result or the org changes
                        key={`${result?.testedAt ?? "none"}:${playgroundOrg?.orgId ?? ""}`}
                        claims={result?.claims}
                        orgMapping={playgroundOrg?.orgMapping}
                        roleMapping={playgroundOrg?.roleMapping}
                        orgId={playgroundOrg?.orgId ?? orgId}
                        showOrgMapping={!orgId}
                    />
                </SettingsSectionBody>
            </SettingsSection>

            <IdpStoreLoginClaimsSection
                apiBase={apiBase}
                storeLoginClaims={storeLoginClaims}
            />
        </SettingsContainer>
    );
}
