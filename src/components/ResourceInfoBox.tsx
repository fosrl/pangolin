"use client";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { InfoIcon, ShieldCheck, ShieldOff } from "lucide-react";
import { useResourceContext } from "@app/hooks/useResourceContext";
import CopyToClipboard from "@app/components/CopyToClipboard";
import {
    InfoSection,
    InfoSectionContent,
    InfoSections,
    InfoSectionTitle
} from "@app/components/InfoSection";
import { useTranslations } from "next-intl";
import CertificateStatus from "@app/components/private/CertificateStatus";
import { toUnicode } from "punycode";
import { useEnvContext } from "@app/hooks/useEnvContext";

type ResourceInfoBoxType = {};

export default function ResourceInfoBox({}: ResourceInfoBoxType) {
    const { resource, authInfo } = useResourceContext();
    const { env } = useEnvContext();

    const t = useTranslations();

    const fullUrl = `${resource.ssl ? "https" : "http"}://${toUnicode(resource.fullDomain || "")}`;

    return (
        <Alert>
            <AlertDescription>
                {/* 4 cols because of the certs */}
                <InfoSections
                    cols={resource.http && env.flags.usePangolinDns ? 4 : 3}
                >
                    {resource.http ? (
                        <>
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
                                        <div className="flex items-start space-x-2 text-green-500">
                                            <ShieldCheck className="w-4 h-4 mt-0.5" />
                                            <span>{t("protected")}</span>
                                        </div>
                                    ) : (
                                        <div className="flex items-center space-x-2 text-yellow-500">
                                            <ShieldOff className="w-4 h-4" />
                                            <span>{t("notProtected")}</span>
                                        </div>
                                    )}
                                </InfoSectionContent>
                            </InfoSection>
                            <InfoSection>
                                <InfoSectionTitle>URL</InfoSectionTitle>
                                <InfoSectionContent>
                                    <CopyToClipboard
                                        text={fullUrl}
                                        isLink={true}
                                    />
                                </InfoSectionContent>
                            </InfoSection>
                            {/* {isEnabled && (
                                <InfoSection>
                                    <InfoSectionTitle>Socket</InfoSectionTitle>
                                    <InfoSectionContent>
                                        {isAvailable ? (
                                            <span className="text-green-500 flex items-center space-x-2">
                                                <div className="w-2 h-2 bg-green-500 rounded-full"></div>
                                                <span>Online</span>
                                            </span>
                                        ) : (
                                            <span className="text-neutral-500 flex items-center space-x-2">
                                                <div className="w-2 h-2 bg-gray-500 rounded-full"></div>
                                                <span>Offline</span>
                                            </span>
                                        )}
                                    </InfoSectionContent>
                                </InfoSection>
                            )} */}
                        </>
                    ) : (
                        <>
                            <InfoSection>
                                <InfoSectionTitle>
                                    {t("protocol")}
                                </InfoSectionTitle>
                                <InfoSectionContent>
                                    <span>
                                        {resource.protocol.toUpperCase()}
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
                    {resource.http &&
                        resource.domainId &&
                        resource.fullDomain &&
                        env.flags.usePangolinDns && (
                            <InfoSection>
                                <InfoSectionTitle>
                                    {t("certificateStatus", {
                                        defaultValue: "Certificate"
                                    })}
                                </InfoSectionTitle>
                                <InfoSectionContent>
                                    <CertificateStatus
                                        orgId={resource.orgId}
                                        domainId={resource.domainId}
                                        fullDomain={resource.fullDomain}
                                        autoFetch={true}
                                        showLabel={false}
                                        polling={true}
                                    />
                                </InfoSectionContent>
                            </InfoSection>
                        )}
                    <InfoSection>
                        <InfoSectionTitle>{t("visibility")}</InfoSectionTitle>
                        <InfoSectionContent>
                            <span>
                                {resource.enabled
                                    ? t("enabled")
                                    : t("disabled")}
                            </span>
                        </InfoSectionContent>
                    </InfoSection>
                </InfoSections>
            </AlertDescription>
        </Alert>
    );
}
