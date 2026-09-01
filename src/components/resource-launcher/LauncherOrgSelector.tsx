"use client";

import { OrgPicker } from "@app/components/OrgPicker";
import { Button } from "@app/components/ui/button";
import { ListUserOrgsResponse } from "@server/routers/org";
import { ChevronDown } from "lucide-react";
import { useTranslations } from "next-intl";

type LauncherOrgSelectorProps = {
    orgId?: string;
    orgs?: ListUserOrgsResponse["orgs"];
};

export function LauncherOrgSelector({ orgId, orgs }: LauncherOrgSelectorProps) {
    const t = useTranslations();
    const selectedOrg = orgs?.find((org) => org.orgId === orgId);

    return (
        <OrgPicker orgId={orgId} orgs={orgs} contentClassName="w-[320px]">
            <Button
                className="inline-flex items-center gap-1 p-0"
                variant="text"
                size="sm"
            >
                <span className="truncate max-w-[200px]">
                    {selectedOrg?.name ?? t("noneSelected")}
                </span>
                <ChevronDown className="size-4 shrink-0" />
            </Button>
        </OrgPicker>
    );
}
