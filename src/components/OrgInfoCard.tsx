"use client";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { useOrgContext } from "@app/hooks/useOrgContext";
import {
    InfoSection,
    InfoSectionContent,
    InfoSections,
    InfoSectionTitle
} from "@app/components/InfoSection";
import { useTranslations } from "next-intl";

type OrgInfoCardProps = {};

export default function OrgInfoCard({}: OrgInfoCardProps) {
    const { org } = useOrgContext();
    const t = useTranslations();

    return (
        <Alert>
            <AlertDescription>
                <InfoSections cols={4}>
                    <InfoSection>
                        <InfoSectionTitle>{t("name")}</InfoSectionTitle>
                        <InfoSectionContent>{org.org.name}</InfoSectionContent>
                    </InfoSection>
                    <InfoSection>
                        <InfoSectionTitle>{t("orgId")}</InfoSectionTitle>
                        <InfoSectionContent>{org.org.orgId}</InfoSectionContent>
                    </InfoSection>
                    <InfoSection>
                        <InfoSectionTitle>{t("subnet")}</InfoSectionTitle>
                        <InfoSectionContent>
                            {org.org.subnet || t("none")}
                        </InfoSectionContent>
                    </InfoSection>
                    <InfoSection>
                        <InfoSectionTitle>
                            {t("utilitySubnet")}
                        </InfoSectionTitle>
                        <InfoSectionContent>
                            {org.org.utilitySubnet || t("none")}
                        </InfoSectionContent>
                    </InfoSection>
                </InfoSections>
            </AlertDescription>
        </Alert>
    );
}
