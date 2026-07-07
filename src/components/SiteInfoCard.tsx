"use client";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { useSiteContext } from "@app/hooks/useSiteContext";
import {
    InfoSection,
    InfoSectionContent,
    InfoSections,
    InfoSectionTitle
} from "@app/components/InfoSection";
import { useTranslations } from "next-intl";
import { countryCodeToFlagEmoji } from "@app/lib/countryCodeToFlagEmoji";

type SiteInfoCardProps = {};

function formatPublicEndpoint(endpoint: string) {
    return endpoint.includes(":")
        ? endpoint.substring(0, endpoint.lastIndexOf(":"))
        : endpoint;
}

export default function SiteInfoCard({}: SiteInfoCardProps) {
    const { site } = useSiteContext();
    const t = useTranslations();

    const identifierSection = (
        <InfoSection>
            <InfoSectionTitle>{t("identifier")}</InfoSectionTitle>
            <InfoSectionContent>{site.niceId}</InfoSectionContent>
        </InfoSection>
    );

    const statusSection = (
        <InfoSection>
            <InfoSectionTitle>{t("status")}</InfoSectionTitle>
            <InfoSectionContent>
                {site.online ? (
                    <div className="flex items-center space-x-2">
                        <div className="w-2 h-2 bg-green-500 rounded-full"></div>
                        <span>{t("online")}</span>
                    </div>
                ) : (
                    <div className="flex items-center space-x-2">
                        <div className="w-2 h-2 bg-neutral-500 rounded-full"></div>
                        <span>{t("offline")}</span>
                    </div>
                )}
            </InfoSectionContent>
        </InfoSection>
    );

    const endpointSection = site.endpoint ? (
        <InfoSection>
            <InfoSectionTitle>{t("publicIpEndpoint")}</InfoSectionTitle>
            <InfoSectionContent>
                {formatPublicEndpoint(site.endpoint)}&nbsp;
                <span>
                    {site.countryCode &&
                        countryCodeToFlagEmoji(site.countryCode)}
                </span>
            </InfoSectionContent>
        </InfoSection>
    ) : null;

    if (site.type === "newt") {
        return (
            <Alert>
                <AlertDescription>
                    <InfoSections cols={site.endpoint ? 4 : 3}>
                        {statusSection}
                        <InfoSection>
                            <InfoSectionTitle>
                                {t("connectionType")}
                            </InfoSectionTitle>
                            <InfoSectionContent>Newt</InfoSectionContent>
                        </InfoSection>
                        <InfoSection>
                            <InfoSectionTitle>
                                {t("newtVersion")}
                            </InfoSectionTitle>
                            <InfoSectionContent>
                                {site.newtVersion
                                    ? `v${site.newtVersion}`
                                    : "-"}
                            </InfoSectionContent>
                        </InfoSection>
                        {endpointSection}
                    </InfoSections>
                </AlertDescription>
            </Alert>
        );
    }

    if (site.type === "wireguard") {
        return (
            <Alert>
                <AlertDescription>
                    <InfoSections cols={site.endpoint ? 4 : 3}>
                        {identifierSection}
                        {statusSection}
                        <InfoSection>
                            <InfoSectionTitle>
                                {t("connectionType")}
                            </InfoSectionTitle>
                            <InfoSectionContent>WireGuard</InfoSectionContent>
                        </InfoSection>
                        {endpointSection}
                    </InfoSections>
                </AlertDescription>
            </Alert>
        );
    }

    if (site.type === "local") {
        return (
            <Alert>
                <AlertDescription>
                    <InfoSections cols={site.endpoint ? 3 : 2}>
                        {identifierSection}
                        <InfoSection>
                            <InfoSectionTitle>
                                {t("connectionType")}
                            </InfoSectionTitle>
                            <InfoSectionContent>
                                {t("local")}
                            </InfoSectionContent>
                        </InfoSection>
                        {endpointSection}
                    </InfoSections>
                </AlertDescription>
            </Alert>
        );
    }

    return (
        <Alert>
            <AlertDescription>
                <InfoSections cols={site.endpoint ? 3 : 2}>
                    {identifierSection}
                    <InfoSection>
                        <InfoSectionTitle>
                            {t("connectionType")}
                        </InfoSectionTitle>
                        <InfoSectionContent>{t("unknown")}</InfoSectionContent>
                    </InfoSection>
                    {endpointSection}
                </InfoSections>
            </AlertDescription>
        </Alert>
    );
}
