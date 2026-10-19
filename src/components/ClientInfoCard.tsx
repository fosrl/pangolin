"use client";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { useClientContext } from "@app/hooks/useClientContext";
import {
    InfoSection,
    InfoSectionContent,
    InfoSections,
    InfoSectionTitle
} from "@app/components/InfoSection";
import IdpTypeBadge from "@app/components/IdpTypeBadge";
import { getUserDisplayName } from "@app/lib/getUserDisplayName";
import { useTranslations } from "next-intl";
import {
    productUpdatesQueries,
    type LatestVersionResponse
} from "@app/lib/queries";
import { useQuery } from "@tanstack/react-query";
import semver from "semver";
import { InfoPopup } from "@app/components/ui/info-popup";

type ClientInfoCardProps = {};

const agentVersionMap: Record<string, string> = {
    "Pangolin Windows": "windows",
    "Pangolin Android": "android",
    "Pangolin iOS": "ios",
    "Pangolin iPadOS": "ios",
    "Pangolin macOS": "mac",
    "Pangolin CLI": "cli",
    "Olm CLI": "olm"
};

export default function SiteInfoCard({}: ClientInfoCardProps) {
    const { client, updateClient } = useClientContext();
    const t = useTranslations();

    const userDisplayName = getUserDisplayName({
        email: client.userEmail,
        name: client.userName,
        username: client.userUsername
    });

    const data = useQuery(productUpdatesQueries.latestVersion(true));
    const latestPlatformVersions = data.data?.data;

    let updateAvailable = false;
    if (client.agent && client.olmVersion && latestPlatformVersions) {
        const agent = agentVersionMap[
            client.agent
        ] as keyof LatestVersionResponse;

        if (agent in latestPlatformVersions) {
            const agentVersion = latestPlatformVersions[agent];

            updateAvailable = Boolean(
                semver.valid(client.olmVersion) &&
                semver.lt(client.olmVersion, agentVersion.latestVersion)
            );
        }
    }

    const cols =
        2 +
        (userDisplayName ? 1 : 0) +
        (client.agent && client.olmVersion ? 1 : 0);

    return (
        <Alert>
            <AlertDescription>
                <InfoSections cols={cols}>
                    <InfoSection>
                        <InfoSectionTitle>{t("name")}</InfoSectionTitle>
                        <InfoSectionContent>{client.name}</InfoSectionContent>
                    </InfoSection>
                    {client.agent && client.olmVersion ? (
                        <InfoSection>
                            <InfoSectionTitle>{t("agent")}</InfoSectionTitle>
                            <InfoSectionContent>
                                <div className="flex items-center gap-2">
                                    <span>
                                        {client.agent +
                                            " v" +
                                            client.olmVersion}
                                    </span>
                                    {updateAvailable && (
                                        <InfoPopup
                                            info={t("updateAvailableInfo")}
                                        />
                                    )}
                                </div>
                            </InfoSectionContent>
                        </InfoSection>
                    ) : null}
                    {userDisplayName ? (
                        <InfoSection>
                            <InfoSectionTitle>{t("user")}</InfoSectionTitle>
                            <InfoSectionContent>
                                <div className="flex flex-wrap items-center gap-2">
                                    <span>{userDisplayName}</span>
                                    {(client.userType ?? "internal") !==
                                        "internal" && (
                                        <IdpTypeBadge
                                            type={client.userType ?? "oidc"}
                                            name={
                                                client.idpName?.trim()
                                                    ? client.idpName
                                                    : t("idpNameInternal")
                                            }
                                            variant={
                                                client.idpVariant ?? undefined
                                            }
                                        />
                                    )}
                                </div>
                            </InfoSectionContent>
                        </InfoSection>
                    ) : null}
                    <InfoSection>
                        <InfoSectionTitle>{t("status")}</InfoSectionTitle>
                        <InfoSectionContent>
                            {client.online ? (
                                <div className="flex items-center space-x-2">
                                    <div className="w-2 h-2 bg-green-500 rounded-full"></div>
                                    <span>{t("connected")}</span>
                                </div>
                            ) : (
                                <div className="flex items-center space-x-2">
                                    <div className="w-2 h-2 bg-neutral-500 rounded-full"></div>
                                    <span>{t("disconnected")}</span>
                                </div>
                            )}
                        </InfoSectionContent>
                    </InfoSection>
                </InfoSections>
            </AlertDescription>
        </Alert>
    );
}
