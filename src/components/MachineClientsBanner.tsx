"use client";

import React from "react";
import { Button } from "@app/components/ui/button";
import { Server, Terminal, Container } from "lucide-react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import DismissableBanner from "./DismissableBanner";

type MachineClientsBannerProps = {
    orgId: string;
};

export const MachineClientsBanner = ({ orgId }: MachineClientsBannerProps) => {
    const t = useTranslations();

    return (
        <DismissableBanner
            storageKey="machine-clients-banner-dismissed"
            version={1}
            title={t("machineClientsBannerTitle")}
            titleIcon={<Server className="w-5 h-5 text-primary" />}
            description={t("machineClientsBannerDescription")}
        >
            <Link
                href="https://docs.pangolin.net/manage/clients/platforms/cli"
                target="_blank"
                rel="noopener noreferrer"
            >
                <Button
                    variant="outline"
                    size="sm"
                    className="gap-2 hover:bg-primary/10 hover:border-primary/50 transition-colors"
                >
                    <Terminal className="w-4 h-4" />
                    {t("machineClientsBannerPangolinCLI")}
                </Button>
            </Link>
            <Link
                href="https://docs.pangolin.net/manage/clients/platforms/cli#docker-pangolin-cli"
                target="_blank"
                rel="noopener noreferrer"
            >
                <Button
                    variant="outline"
                    size="sm"
                    className="gap-2 hover:bg-primary/10 hover:border-primary/50 transition-colors"
                >
                    <Container className="w-4 h-4" />
                    {t("machineClientsBannerOlmContainer")}
                </Button>
            </Link>
        </DismissableBanner>
    );
};

export default MachineClientsBanner;
