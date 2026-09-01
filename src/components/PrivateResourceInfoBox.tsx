"use client";

import CertificateStatus from "@app/components/CertificateStatus";
import CopyToClipboard from "@app/components/CopyToClipboard";
import {
    InfoSection,
    InfoSectionContent,
    InfoSections,
    InfoSectionTitle
} from "@app/components/InfoSection";
import { Alert, AlertDescription } from "@app/components/ui/alert";
import { useSiteResourceContext } from "@app/hooks/useSiteResourceContext";
import { formatPortRestrictionDisplay } from "@app/lib/launcherResourceDetails";
import {
    formatSiteResourceAccess,
    formatSiteResourceDestinationDisplay,
    isSafeUrlForLink,
    type LauncherAccessFields
} from "@app/lib/launcherResourceAccess";
import type { PrivateResourceMode } from "@app/lib/privateResourceForm";
import { useTranslations } from "next-intl";

type SiteResourceInfoInput = {
    orgId: string;
    mode: PrivateResourceMode;
    destination: string | null;
    destinationPort: number | null;
    scheme: "http" | "https" | null;
    ssl: boolean;
    domainId?: string | null;
    fullDomain?: string | null;
    alias?: string | null;
    aliasAddress?: string | null;
    authDaemonMode?: "site" | "remote" | "native" | null;
    tcpPortRangeString?: string | null;
    udpPortRangeString?: string | null;
};

type SiteResourceInfoBoxVariant = "settings" | "panel";

type SiteResourceInfoSectionsProps = {
    siteResource: SiteResourceInfoInput;
    access: LauncherAccessFields;
    variant: SiteResourceInfoBoxVariant;
    accessClassName?: string;
};

function AccessMethodContent({
    accessDisplay,
    accessCopyValue,
    accessUrl,
    className
}: LauncherAccessFields & { className?: string }) {
    if (!accessDisplay) {
        return <span>-</span>;
    }

    const href = accessUrl ?? undefined;
    const canLink = Boolean(href && isSafeUrlForLink(href));

    if (canLink && href) {
        return (
            <CopyToClipboard
                text={href}
                displayText={accessDisplay}
                isLink
                className={className}
            />
        );
    }

    return (
        <CopyToClipboard
            text={accessCopyValue || accessDisplay}
            displayText={accessDisplay}
            isLink={false}
            className={className}
        />
    );
}

export function PrivateResourceInfoSections({
    siteResource,
    access,
    variant,
    accessClassName
}: SiteResourceInfoSectionsProps) {
    const t = useTranslations();
    const isPanel = variant === "panel";

    const modeLabel: Record<PrivateResourceMode, string> = {
        host: t("editInternalResourceDialogModeHost"),
        cidr: t("editInternalResourceDialogModeCidr"),
        http: t("editInternalResourceDialogModeHttp"),
        ssh: t("editInternalResourceDialogModeSsh"),
        inference: t("editInternalResourceDialogModeInference")
    };

    const destination = formatSiteResourceDestinationDisplay({
        mode: siteResource.mode,
        destination: siteResource.destination,
        destinationPort: siteResource.destinationPort,
        scheme: siteResource.scheme
    });

    const portRestrictions = formatPortRestrictionDisplay({
        tcpPortRangeString: siteResource.tcpPortRangeString ?? "*",
        udpPortRangeString: siteResource.udpPortRangeString ?? "*"
    });
    const showAlias =
        siteResource.mode !== "cidr" &&
        siteResource.mode !== "http" &&
        siteResource.mode !== "inference";
    const showDestination =
        !(
            siteResource.mode === "ssh" &&
            siteResource.authDaemonMode === "native"
        ) && siteResource.mode !== "inference";
    const showCertificate = !!(
        (siteResource.mode === "http" || siteResource.mode === "inference") &&
        siteResource.ssl &&
        siteResource.domainId &&
        siteResource.fullDomain
    );
    const showPortRestrictions =
        isPanel &&
        siteResource.mode !== "http" &&
        siteResource.mode !== "inference";

    const numSections =
        2 +
        (showDestination ? 1 : 0) +
        (showAlias ? 1 : 0) +
        (showCertificate ? 1 : 0) +
        (showPortRestrictions ? 1 : 0);

    const sections = (
        <InfoSections cols={numSections} layout={isPanel ? "panel" : "default"}>
            <InfoSection>
                <InfoSectionTitle>{t("type")}</InfoSectionTitle>
                <InfoSectionContent>
                    {modeLabel[siteResource.mode]}
                </InfoSectionContent>
            </InfoSection>

            <InfoSection>
                <InfoSectionTitle>{t("access")}</InfoSectionTitle>
                <InfoSectionContent>
                    <AccessMethodContent
                        accessDisplay={access.accessDisplay}
                        accessCopyValue={access.accessCopyValue}
                        accessUrl={access.accessUrl}
                        className={accessClassName}
                    />
                </InfoSectionContent>
            </InfoSection>

            {showDestination ? (
                <InfoSection>
                    <InfoSectionTitle>
                        {t("editInternalResourceDialogDestination")}
                    </InfoSectionTitle>
                    <InfoSectionContent>
                        {destination || "-"}
                    </InfoSectionContent>
                </InfoSection>
            ) : null}

            {showAlias ? (
                <InfoSection>
                    <InfoSectionTitle>
                        {t("editInternalResourceDialogAlias")}
                    </InfoSectionTitle>
                    <InfoSectionContent>
                        {siteResource.alias?.trim() ? siteResource.alias : "-"}
                    </InfoSectionContent>
                </InfoSection>
            ) : null}

            {showCertificate ? (
                <InfoSection>
                    <InfoSectionTitle>
                        {t("certificateStatus", {
                            defaultValue: "Certificate"
                        })}
                    </InfoSectionTitle>
                    <InfoSectionContent>
                        <CertificateStatus
                            orgId={siteResource.orgId}
                            domainId={siteResource.domainId!}
                            fullDomain={siteResource.fullDomain!}
                            showLabel={false}
                            polling={true}
                        />
                    </InfoSectionContent>
                </InfoSection>
            ) : null}

            {showPortRestrictions ? (
                <InfoSection>
                    <InfoSectionTitle>{t("portRestrictions")}</InfoSectionTitle>
                    <InfoSectionContent>
                        {!portRestrictions.hasNonDefaultPorts ? (
                            <span>
                                {t("resourceLauncherNoPortRestrictions")}
                            </span>
                        ) : (
                            <div className="space-y-1">
                                {portRestrictions.tcp.state !== "all" ? (
                                    <div>
                                        {t("resourceLauncherTcp")}:{" "}
                                        {portRestrictions.tcp.state ===
                                        "blocked"
                                            ? t("blocked")
                                            : portRestrictions.tcp.ports}
                                    </div>
                                ) : null}
                                {portRestrictions.udp.state !== "all" ? (
                                    <div>
                                        {t("resourceLauncherUdp")}:{" "}
                                        {portRestrictions.udp.state ===
                                        "blocked"
                                            ? t("blocked")
                                            : portRestrictions.udp.ports}
                                    </div>
                                ) : null}
                            </div>
                        )}
                    </InfoSectionContent>
                </InfoSection>
            ) : null}
        </InfoSections>
    );

    if (isPanel) {
        return sections;
    }

    return (
        <Alert>
            <AlertDescription>{sections}</AlertDescription>
        </Alert>
    );
}

type SiteResourceInfoBoxProps = {
    variant?: "settings";
};

export default function SiteResourceInfoBox({
    variant = "settings"
}: SiteResourceInfoBoxProps) {
    const { siteResource } = useSiteResourceContext();

    const access = formatSiteResourceAccess({
        mode: siteResource.mode,
        destination: siteResource.destination,
        destinationPort: siteResource.destinationPort,
        scheme: siteResource.scheme,
        ssl: siteResource.ssl,
        fullDomain: siteResource.fullDomain ?? null,
        alias: siteResource.alias ?? null,
        aliasAddress: siteResource.aliasAddress ?? null
    });

    return (
        <PrivateResourceInfoSections
            siteResource={siteResource}
            access={access}
            variant={variant}
        />
    );
}
