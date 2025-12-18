"use client";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { InfoIcon } from "lucide-react";
import {
    InfoSection,
    InfoSectionContent,
    InfoSections,
    InfoSectionTitle
} from "@app/components/InfoSection";
import { useTranslations } from "next-intl";
import { useRemoteExitNodeContext } from "@app/hooks/useRemoteExitNodeContext";

type ExitNodeInfoCardProps = {};

export default function ExitNodeInfoCard({}: ExitNodeInfoCardProps) {
    const { remoteExitNode, updateRemoteExitNode } = useRemoteExitNodeContext();
    const t = useTranslations();

    return (
        <Alert>
            <AlertDescription>
                <InfoSections cols={2}>
                    <>
                        <InfoSection>
                            <InfoSectionTitle>{t("status")}</InfoSectionTitle>
                            <InfoSectionContent>
                                {remoteExitNode.online ? (
                                    <div className="text-green-500 flex items-center space-x-2">
                                        <div className="w-2 h-2 bg-green-500 rounded-full"></div>
                                        <span>{t("online")}</span>
                                    </div>
                                ) : (
                                    <div className="text-neutral-500 flex items-center space-x-2">
                                        <div className="w-2 h-2 bg-gray-500 rounded-full"></div>
                                        <span>{t("offline")}</span>
                                    </div>
                                )}
                            </InfoSectionContent>
                        </InfoSection>
                    </>
                    <InfoSection>
                        <InfoSectionTitle>{t("address")}</InfoSectionTitle>
                        <InfoSectionContent>
                            {remoteExitNode.address}
                        </InfoSectionContent>
                    </InfoSection>
                </InfoSections>
            </AlertDescription>
        </Alert>
    );
}
