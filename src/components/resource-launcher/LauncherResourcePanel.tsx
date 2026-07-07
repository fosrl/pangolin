"use client";

import CopyToClipboard from "@app/components/CopyToClipboard";
import {
    InfoSection,
    InfoSectionContent,
    InfoSections,
    InfoSectionTitle
} from "@app/components/InfoSection";
import {
    SettingsSection,
    SettingsSectionBody,
    SettingsSectionDescription,
    SettingsSectionHeader,
    SettingsSectionTitle
} from "@app/components/Settings";
import {
    SidePanel,
    SidePanelBody,
    SidePanelContent,
    SidePanelFooter,
    SidePanelHeader,
    SidePanelTitle
} from "@app/components/SidePanel";
import { Alert, AlertDescription, AlertTitle } from "@app/components/ui/alert";
import { Button } from "@app/components/ui/button";
import {
    derivePublicAuthState,
    formatPortRestrictionDisplay,
    formatPublicResourceType
} from "@app/lib/launcherResourceDetails";
import { getLauncherResourceAdminHref } from "@app/lib/launcherResourceAdminHref";
import {
    formatSiteResourceDestinationDisplay,
    isSafeUrlForLink
} from "@app/lib/launcherResourceAccess";
import { launcherQueries } from "@app/lib/queries";
import type { LauncherResource } from "@server/routers/launcher/types";
import type { GetResourceAuthInfoResponse } from "@server/routers/resource/getResourceAuthInfo";
import type { GetResourceResponse } from "@server/routers/resource/getResource";
import type { GetSiteResourceResponse } from "@server/routers/siteResource/getSiteResource";
import { useQuery } from "@tanstack/react-query";
import {
    AlertCircle,
    CheckCircle2,
    Clock,
    ExternalLink,
    Loader2,
    ShieldCheck,
    ShieldOff,
    XCircle
} from "lucide-react";
import { useTranslations } from "next-intl";
import Link from "next/link";

type LauncherResourcePanelProps = {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    resource: LauncherResource | null;
    orgId: string;
    isAdmin: boolean;
};

type LauncherResourceDetailResult =
    | {
          resourceType: "public";
          data: GetResourceResponse;
          authInfo: GetResourceAuthInfoResponse;
      }
    | { resourceType: "site"; data: GetSiteResourceResponse };

function AccessMethodContent({
    accessDisplay,
    accessCopyValue,
    accessUrl
}: {
    accessDisplay: string;
    accessCopyValue: string;
    accessUrl?: string | null;
}) {
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
                isLink={true}
                className="text-base"
            />
        );
    }

    return (
        <CopyToClipboard
            text={accessCopyValue || accessDisplay}
            displayText={accessDisplay}
            isLink={false}
            className="text-base"
        />
    );
}

function HealthStatusDisplay({
    health
}: {
    health: string | null | undefined;
}) {
    const t = useTranslations();
    const status = health ?? "unknown";

    if (status === "healthy") {
        return (
            <div className="flex items-center space-x-2">
                <CheckCircle2 className="size-4 shrink-0 text-green-500" />
                <span>{t("resourcesTableHealthy")}</span>
            </div>
        );
    }

    if (status === "degraded") {
        return (
            <div className="flex items-center space-x-2">
                <CheckCircle2 className="size-4 shrink-0 text-yellow-500" />
                <span>{t("resourcesTableDegraded")}</span>
            </div>
        );
    }

    if (status === "unhealthy") {
        return (
            <div className="flex items-center space-x-2">
                <XCircle className="size-4 shrink-0 text-destructive" />
                <span>{t("resourcesTableUnhealthy")}</span>
            </div>
        );
    }

    return (
        <div className="flex items-center space-x-2">
            <Clock className="size-4 shrink-0 text-muted-foreground" />
            <span>{t("resourcesTableUnknown")}</span>
        </div>
    );
}

const PUBLIC_AUTH_BROWSER_MODES = ["http", "ssh", "rdp", "vnc"];

function AuthMethodStatusDisplay({ enabled }: { enabled: boolean }) {
    const t = useTranslations();

    return (
        <div className="flex items-center gap-2">
            {enabled ? (
                <CheckCircle2 className="size-4 text-green-600" />
            ) : (
                <XCircle className="size-4 text-red-600" />
            )}
            <span>{enabled ? t("enabled") : t("disabled")}</span>
        </div>
    );
}

function PublicResourceAuthMethods({
    authInfo
}: {
    authInfo: GetResourceAuthInfoResponse;
}) {
    const t = useTranslations();

    const authMethods = [
        {
            key: "sso",
            title: t("policyAuthSsoTitle"),
            enabled: authInfo.sso
        },
        {
            key: "password",
            title: t("policyAuthPasscodeTitle"),
            enabled: authInfo.password
        },
        {
            key: "pincode",
            title: t("policyAuthPincodeTitle"),
            enabled: authInfo.pincode
        },
        {
            key: "whitelist",
            title: t("policyAuthEmailTitle"),
            enabled: authInfo.whitelist
        },
        {
            key: "headerAuth",
            title: t("policyAuthHeaderAuthTitle"),
            enabled: authInfo.headerAuth
        }
    ];

    return (
        <SettingsSection>
            <SettingsSectionHeader>
                <SettingsSectionTitle>
                    {t("authentication")}
                </SettingsSectionTitle>
                <SettingsSectionDescription>
                    {t("resourceLauncherAuthMethodsDescription")}
                </SettingsSectionDescription>
            </SettingsSectionHeader>
            <SettingsSectionBody>
                <InfoSections cols={authMethods.length} layout="panel">
                    {authMethods.map((method) => (
                        <InfoSection key={method.key}>
                            <InfoSectionTitle>{method.title}</InfoSectionTitle>
                            <InfoSectionContent>
                                <AuthMethodStatusDisplay
                                    enabled={method.enabled}
                                />
                            </InfoSectionContent>
                        </InfoSection>
                    ))}
                </InfoSections>
            </SettingsSectionBody>
        </SettingsSection>
    );
}

function PublicResourceDetails({
    launcherResource,
    resource,
    authInfo
}: {
    launcherResource: LauncherResource;
    resource: GetResourceResponse;
    authInfo: GetResourceAuthInfoResponse;
}) {
    const t = useTranslations();
    const supportsAuth = PUBLIC_AUTH_BROWSER_MODES.includes(
        resource.mode || ""
    );
    const authState = derivePublicAuthState(resource.mode, authInfo);
    const infoSectionCount = supportsAuth ? 4 : 3;

    return (
        <div className="space-y-4">
            <SettingsSection>
                <SettingsSectionHeader>
                    <SettingsSectionTitle>
                        {t("resourceLauncherResourceDetails")}
                    </SettingsSectionTitle>
                    <SettingsSectionDescription>
                        {t("resourceLauncherResourceDetailsDescription")}
                    </SettingsSectionDescription>
                </SettingsSectionHeader>
                <SettingsSectionBody>
                    <InfoSections cols={infoSectionCount} layout="panel">
                        <InfoSection>
                            <InfoSectionTitle>{t("type")}</InfoSectionTitle>
                            <InfoSectionContent>
                                {formatPublicResourceType(resource)}
                            </InfoSectionContent>
                        </InfoSection>
                        <InfoSection>
                            <InfoSectionTitle>{t("access")}</InfoSectionTitle>
                            <InfoSectionContent>
                                <AccessMethodContent
                                    accessDisplay={
                                        launcherResource.accessDisplay
                                    }
                                    accessCopyValue={
                                        launcherResource.accessCopyValue
                                    }
                                    accessUrl={launcherResource.accessUrl}
                                />
                            </InfoSectionContent>
                        </InfoSection>
                        {supportsAuth ? (
                            <InfoSection>
                                <InfoSectionTitle>
                                    {t("authentication")}
                                </InfoSectionTitle>
                                <InfoSectionContent>
                                    {authState === "protected" ? (
                                        <div className="flex items-center space-x-2">
                                            <ShieldCheck className="size-4 shrink-0 text-green-500" />
                                            <span>{t("protected")}</span>
                                        </div>
                                    ) : (
                                        <div className="flex items-center space-x-2">
                                            <ShieldOff className="size-4 shrink-0 text-yellow-500" />
                                            <span>{t("notProtected")}</span>
                                        </div>
                                    )}
                                </InfoSectionContent>
                            </InfoSection>
                        ) : null}
                        <InfoSection>
                            <InfoSectionTitle>{t("health")}</InfoSectionTitle>
                            <InfoSectionContent>
                                <HealthStatusDisplay health={resource.health} />
                            </InfoSectionContent>
                        </InfoSection>
                    </InfoSections>
                </SettingsSectionBody>
            </SettingsSection>
            {supportsAuth ? (
                <PublicResourceAuthMethods authInfo={authInfo} />
            ) : null}
        </div>
    );
}

function PrivateResourceDetails({
    launcherResource,
    resource
}: {
    launcherResource: LauncherResource;
    resource: GetSiteResourceResponse;
}) {
    const t = useTranslations();
    const modeLabel: Record<GetSiteResourceResponse["mode"], string> = {
        host: t("editInternalResourceDialogModeHost"),
        cidr: t("editInternalResourceDialogModeCidr"),
        http: t("editInternalResourceDialogModeHttp"),
        ssh: t("editInternalResourceDialogModeSsh")
    };
    const destination = formatSiteResourceDestinationDisplay({
        mode: resource.mode,
        destination: resource.destination,
        destinationPort: resource.destinationPort,
        scheme: resource.scheme
    });
    const portRestrictions = formatPortRestrictionDisplay(resource);
    const showAlias = resource.mode !== "cidr" && resource.mode !== "http";
    const showDestination = !(
        resource.mode === "ssh" && resource.authDaemonMode === "native"
    );
    const infoSectionCount =
        2 + (showDestination ? 1 : 0) + (showAlias ? 1 : 0) + 1;

    return (
        <div className="space-y-4">
            <Alert variant="default">
                <AlertCircle className="size-4" />
                <AlertTitle>
                    {t("resourceLauncherPrivateClientRequiredTitle")}
                </AlertTitle>
                <AlertDescription>
                    <span>
                        {t("resourceLauncherPrivateClientRequired")}{" "}
                        <a
                            href="https://pangolin.net/downloads"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 text-primary hover:underline"
                        >
                            {t("resourceLauncherDownloadClient")}
                            <ExternalLink className="size-3.5 shrink-0" />
                        </a>
                    </span>
                </AlertDescription>
            </Alert>

            <SettingsSection>
                <SettingsSectionHeader>
                    <SettingsSectionTitle>
                        {t("resourceLauncherResourceDetails")}
                    </SettingsSectionTitle>
                    <SettingsSectionDescription>
                        {t("resourceLauncherResourceDetailsDescription")}
                    </SettingsSectionDescription>
                </SettingsSectionHeader>
                <SettingsSectionBody>
                    <InfoSections cols={infoSectionCount} layout="panel">
                        <InfoSection>
                            <InfoSectionTitle>{t("type")}</InfoSectionTitle>
                            <InfoSectionContent>
                                {modeLabel[resource.mode]}
                            </InfoSectionContent>
                        </InfoSection>
                        <InfoSection>
                            <InfoSectionTitle>{t("access")}</InfoSectionTitle>
                            <InfoSectionContent>
                                <AccessMethodContent
                                    accessDisplay={
                                        launcherResource.accessDisplay
                                    }
                                    accessCopyValue={
                                        launcherResource.accessCopyValue
                                    }
                                    accessUrl={launcherResource.accessUrl}
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
                                    {resource.alias?.trim()
                                        ? resource.alias
                                        : "-"}
                                </InfoSectionContent>
                            </InfoSection>
                        ) : null}
                        <InfoSection>
                            <InfoSectionTitle>
                                {t("portRestrictions")}
                            </InfoSectionTitle>
                            <InfoSectionContent>
                                {!portRestrictions.hasNonDefaultPorts ? (
                                    <span>
                                        {t(
                                            "resourceLauncherNoPortRestrictions"
                                        )}
                                    </span>
                                ) : (
                                    <div className="space-y-1">
                                        {portRestrictions.tcp.state !==
                                        "all" ? (
                                            <div>
                                                {t("resourceLauncherTcp")}:{" "}
                                                {portRestrictions.tcp.state ===
                                                "blocked"
                                                    ? t("blocked")
                                                    : portRestrictions.tcp
                                                          .ports}
                                            </div>
                                        ) : null}
                                        {portRestrictions.udp.state !==
                                        "all" ? (
                                            <div>
                                                {t("resourceLauncherUdp")}:{" "}
                                                {portRestrictions.udp.state ===
                                                "blocked"
                                                    ? t("blocked")
                                                    : portRestrictions.udp
                                                          .ports}
                                            </div>
                                        ) : null}
                                    </div>
                                )}
                            </InfoSectionContent>
                        </InfoSection>
                    </InfoSections>
                </SettingsSectionBody>
            </SettingsSection>
        </div>
    );
}

function LauncherResourcePanelBody({
    orgId,
    resource,
    open
}: {
    orgId: string;
    resource: LauncherResource;
    open: boolean;
}) {
    const t = useTranslations();
    const { data, isPending, isError } = useQuery({
        ...launcherQueries.resourceDetail(orgId, resource),
        enabled: open
    });

    if (isPending) {
        return (
            <div className="flex items-center justify-center py-12 text-muted-foreground">
                <Loader2 className="size-6 animate-spin" />
            </div>
        );
    }

    if (isError || !data) {
        return (
            <p className="text-sm text-muted-foreground">
                {t("resourceLauncherFailedToLoadDetails")}
            </p>
        );
    }

    const detail = data as LauncherResourceDetailResult;

    if (detail.resourceType === "public") {
        return (
            <PublicResourceDetails
                launcherResource={resource}
                resource={detail.data}
                authInfo={detail.authInfo}
            />
        );
    }

    return (
        <PrivateResourceDetails
            launcherResource={resource}
            resource={detail.data}
        />
    );
}

export function LauncherResourcePanel({
    open,
    onOpenChange,
    resource,
    orgId,
    isAdmin
}: LauncherResourcePanelProps) {
    const t = useTranslations();

    return (
        <SidePanel open={open} onOpenChange={onOpenChange}>
            <SidePanelContent>
                <SidePanelHeader>
                    <SidePanelTitle>{resource?.name ?? ""}</SidePanelTitle>
                </SidePanelHeader>
                <SidePanelBody>
                    {resource ? (
                        <LauncherResourcePanelBody
                            orgId={orgId}
                            resource={resource}
                            open={open}
                        />
                    ) : null}
                </SidePanelBody>
                <SidePanelFooter>
                    <Button
                        variant="outline"
                        onClick={() => onOpenChange(false)}
                    >
                        {t("close")}
                    </Button>
                    {isAdmin && resource ? (
                        <Button variant="outline" asChild>
                            <Link
                                href={getLauncherResourceAdminHref(
                                    orgId,
                                    resource
                                )}
                            >
                                {t("resourceLauncherViewAsAdmin")}
                            </Link>
                        </Button>
                    ) : null}
                </SidePanelFooter>
            </SidePanelContent>
        </SidePanel>
    );
}
