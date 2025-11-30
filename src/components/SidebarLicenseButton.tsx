"use client";

import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger
} from "@app/components/ui/tooltip";
import { Button } from "./ui/button";
import { TicketCheck } from "lucide-react";
import { useTranslations } from "next-intl";
import { useLicenseStatusContext } from "@app/hooks/useLicenseStatusContext";
import Link from "next/link";

interface SidebarLicenseButtonProps {
    isCollapsed?: boolean;
}

export default function SidebarLicenseButton({
    isCollapsed = false
}: SidebarLicenseButtonProps) {
    const { licenseStatus, updateLicenseStatus } = useLicenseStatusContext();

    const url = "https://docs.pangolin.net/self-host/enterprise-edition";

    const t = useTranslations();

    return (
        <>
            {!licenseStatus?.isHostLicensed ? (
                isCollapsed ? (
                    <TooltipProvider>
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <Link href={url}>
                                    <Button size="icon" className="w-8 h-8">
                                        <TicketCheck className="h-4 w-4" />
                                    </Button>
                                </Link>
                            </TooltipTrigger>
                            <TooltipContent side="right" sideOffset={8}>
                                {t("sidebarEnableEnterpriseLicense")}
                            </TooltipContent>
                        </Tooltip>
                    </TooltipProvider>
                ) : (
                    <Link href={url}>
                        <Button size="sm" className="gap-2 w-full">
                            {t("sidebarEnableEnterpriseLicense")}
                        </Button>
                    </Link>
                )
            ) : null}
        </>
    );
}
