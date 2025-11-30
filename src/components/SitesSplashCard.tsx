"use client";

import React, { useState, useEffect } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ArrowRight, DockIcon as Docker, Globe, Server, X } from "lucide-react";
import Link from "next/link";
import { useEnvContext } from "@app/hooks/useEnvContext";
import { useTranslations } from 'next-intl';

export const SitesSplashCard = () => {
    const [isDismissed, setIsDismissed] = useState(true);
    const { env } = useEnvContext();

    const key = "sites-splash-card-dismissed";
    const t = useTranslations();

    useEffect(() => {
        const dismissed = localStorage.getItem(key);
        if (dismissed === "true") {
            setIsDismissed(true);
        } else {
            setIsDismissed(false);
        }
    }, []);

    const handleDismiss = () => {
        setIsDismissed(true);
        localStorage.setItem(key, "true");
    };

    if (isDismissed) {
        return null;
    }

    return (
        <Card className="w-full mx-auto overflow-hidden mb-8 hidden md:block relative">
            <button
                onClick={handleDismiss}
                className="absolute top-2 right-2 p-2"
                aria-label={t('dismiss')}
            >
                <X className="w-5 h-5" />
            </button>
            <CardContent className="grid gap-6 p-6 sm:grid-cols-2">
                <div className="space-y-4">
                    <h3 className="text-xl font-semibold flex items-center gap-2">
                        <Globe className="text-blue-500" />
                        Newt ({t('recommended')})
                    </h3>
                    <p className="text-sm">
                        {t('siteNewtDescription')}
                    </p>
                    <ul className="text-sm text-muted-foreground space-y-2">
                        <li className="flex items-center gap-2">
                            <Server className="text-green-500 w-4 h-4" />
                            {t('siteRunsInDocker')}
                        </li>
                        <li className="flex items-center gap-2">
                            <Server className="text-green-500 w-4 h-4" />
                            {t('siteRunsInShell')}
                        </li>
                    </ul>

                    <div className="mt-4">
                        <Link
                            href="https://docs.pangolin.net/manage/sites/install-site"
                            target="_blank"
                            rel="noopener noreferrer"
                        >
                            <Button
                                className="w-full flex items-center"
                                variant="secondary"
                            >
                                {t('siteInstallNewt')}{" "}
                                <ArrowRight className="ml-2 w-4 h-4" />
                            </Button>
                        </Link>
                    </div>
                </div>
                <div className="space-y-4">
                    <h3 className="text-xl font-semibold flex items-center gap-2">
                        {t('siteWg')}
                    </h3>
                    <p className="text-sm">
                        {t('siteWgAnyClients')}
                    </p>
                    <ul className="text-sm text-muted-foreground space-y-2">
                        <li className="flex items-center gap-2">
                            <Docker className="text-purple-500 w-4 h-4" />
                            {t('siteWgCompatibleAllClients')}
                        </li>
                        <li className="flex items-center gap-2">
                            <Server className="text-purple-500 w-4 h-4" />
                            {t('siteWgManualConfigurationRequired')}
                        </li>
                    </ul>
                </div>
            </CardContent>
        </Card>
    );
};

export default SitesSplashCard;
