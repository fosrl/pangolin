"use client";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
    ShieldCheck,
    ShieldOff,
    EyeOff,
    CheckCircle2,
    XCircle
} from "lucide-react";
import { useResourceContext } from "@app/hooks/useResourceContext";
import CopyToClipboard from "@app/components/CopyToClipboard";
import {
    InfoSection,
    InfoSectionContent,
    InfoSections,
    InfoSectionTitle
} from "@app/components/InfoSection";
import { useTranslations } from "next-intl";
import CertificateStatus from "@app/components/CertificateStatus";
import { toUnicode } from "punycode";
import { build } from "@server/build";

type ResourceInfoBoxType = {};

export default function ResourceInfoBox({}: ResourceInfoBoxType) {
    const { resource, authInfo } = useResourceContext();

    const t = useTranslations();

    const fullUrl = `${resource.ssl ? "https" : "http"}://${toUnicode(resource.fullDomain || "")}`;

    const showCertificate = !!(
        ["http", "ssh", "rdp", "vnc"].includes(resource.mode) &&
        resource.domainId &&
        resource.fullDomain &&
        build != "oss"
    );
    const showType = !!(
        ["http", "ssh", "rdp", "vnc"].includes(resource.mode) && resource.mode
    );
    const showHealth =
        !["ssh", "rdp", "vnc"].includes(resource.mode || "") &&
        !!resource.health &&
        resource.health !== "unknown";
    const showVisibility = !resource.enabled;

    const numSections = [
        true, // URL or Protocol
        true, // Authentication or Port
        showType,
        showCertificate,
        showHealth,
        showVisibility
    ].filter(Boolean).length;

    return (
        <Alert>
            <AlertDescription>
                <InfoSections cols={numSections}>
                    {/* <InfoSection>
                        <InfoSectionTitle>{t("identifier")}</InfoSectionTitle>
                        <InfoSectionContent>
                            <span className="inline-flex items-center">
                                {resource.niceId}
                            </span>
                        </InfoSectionContent>
                    </InfoSection> */}
                    {["http", "ssh", "rdp", "vnc"].includes(resource.mode) ? (
                        <>
                            <InfoSection>
                                <InfoSectionTitle>URL</InfoSectionTitle>
                                <InfoSectionContent>
                                    {resource.wildcard ? (
                                        <span className="inline-flex items-center">
                                            {fullUrl}
                                        </span>
                                    ) : (
                                        <CopyToClipboard
                                            text={fullUrl}
                                            isLink={true}
                                        />
                                    )}
                                </InfoSectionContent>
                            </InfoSection>
                            {showType && (
                                <InfoSection>
                                    <InfoSectionTitle>
                                        {t("type")}
                                    </InfoSectionTitle>
                                    <InfoSectionContent>
                                        <span className="inline-flex items-center">
                                            {resource.mode == "http"
                                                ? resource.ssl
                                                    ? "HTTPS"
                                                    : "HTTP"
                                                : resource.mode?.toUpperCase()}
                                        </span>
                                    </InfoSectionContent>
                                </InfoSection>
                            )}
                            <InfoSection>
                                <InfoSectionTitle>
                                    {t("authentication")}
                                </InfoSectionTitle>
                                <InfoSectionContent>
                                    {authInfo.password ||
                                    authInfo.pincode ||
                                    authInfo.sso ||
                                    authInfo.whitelist ||
                                    authInfo.headerAuth ? (
                                        <div className="flex items-center space-x-2">
                                            <ShieldCheck className="w-4 h-4 flex-shrink-0 text-green-500" />
                                            <span>{t("protected")}</span>
                                        </div>
                                    ) : (
                                        <div className="flex items-center space-x-2">
                                            <ShieldOff className="w-4 h-4 flex-shrink-0 text-yellow-500" />
                                            <span>{t("notProtected")}</span>
                                        </div>
                                    )}
                                </InfoSectionContent>
                            </InfoSection>
                        </>
                    ) : (
                        <>
                            <InfoSection>
                                <InfoSectionTitle>
                                    {t("protocol")}
                                </InfoSectionTitle>
                                <InfoSectionContent>
                                    <span className="inline-flex items-center">
                                        {resource.mode?.toUpperCase()}
                                    </span>
                                </InfoSectionContent>
                            </InfoSection>
                            <InfoSection>
                                <InfoSectionTitle>{t("port")}</InfoSectionTitle>
                                <InfoSectionContent>
                                    <CopyToClipboard
                                        text={resource.proxyPort!.toString()}
                                        isLink={false}
                                    />
                                </InfoSectionContent>
                            </InfoSection>
                            {/* {build == "oss" && (
                                <InfoSection>
                                    <InfoSectionTitle>
                                        {t("externalProxyEnabled")}
                                    </InfoSectionTitle>
                                    <InfoSectionContent>
                                        <span>
                                            {resource.enableProxy
                                                ? t("enabled")
                                                : t("disabled")}
                                        </span>
                                    </InfoSectionContent>
                                </InfoSection>
                            )} */}
                        </>
                    )}
                    {/* <InfoSection> */}
                    {/*     <InfoSectionTitle>{t('visibility')}</InfoSectionTitle> */}
                    {/*     <InfoSectionContent> */}
                    {/*         <span> */}
                    {/*             {resource.enabled ? t('enabled') : t('disabled')} */}
                    {/*         </span> */}
                    {/*     </InfoSectionContent> */}
                    {/* </InfoSection> */}
                    {/* Certificate Status Column */}
                    {showCertificate && (
                        <InfoSection>
                            <InfoSectionTitle>
                                {t("certificateStatus", {
                                    defaultValue: "Certificate"
                                })}
                            </InfoSectionTitle>
                            <InfoSectionContent>
                                <CertificateStatus
                                    orgId={resource.orgId}
                                    domainId={resource.domainId!}
                                    fullDomain={resource.fullDomain!}
                                    autoFetch={true}
                                    showLabel={false}
                                    polling={true}
                                />
                            </InfoSectionContent>
                        </InfoSection>
                    )}
                    {showHealth && (
                        <InfoSection>
                            <InfoSectionTitle>{t("health")}</InfoSectionTitle>
                            <InfoSectionContent>
                                {resource.health === "healthy" && (
                                    <div className="flex items-center space-x-2">
                                        <CheckCircle2 className="w-4 h-4 flex-shrink-0 text-green-500" />
                                        <span>
                                            {t("resourcesTableHealthy")}
                                        </span>
                                    </div>
                                )}
                                {resource.health === "degraded" && (
                                    <div className="flex items-center space-x-2">
                                        <CheckCircle2 className="w-4 h-4 flex-shrink-0 text-yellow-500" />
                                        <span>
                                            {t("resourcesTableDegraded")}
                                        </span>
                                    </div>
                                )}
                                {resource.health === "unhealthy" && (
                                    <div className="flex items-center space-x-2">
                                        <XCircle className="w-4 h-4 flex-shrink-0 text-destructive" />
                                        <span>
                                            {t("resourcesTableUnhealthy")}
                                        </span>
                                    </div>
                                )}
                            </InfoSectionContent>
                        </InfoSection>
                    )}
                    {showVisibility && (
                        <InfoSection>
                            <InfoSectionTitle>
                                {t("visibility")}
                            </InfoSectionTitle>
                            <InfoSectionContent>
                                <div className="flex items-center space-x-2">
                                    <EyeOff className="w-4 h-4 flex-shrink-0 text-neutral-500" />
                                    <span>{t("disabled")}</span>
                                </div>
                            </InfoSectionContent>
                        </InfoSection>
                    )}
                </InfoSections>
            </AlertDescription>
        </Alert>
    );
}
