"use client";

import { Button } from "@app/components/ui/button";
import {
    Popover,
    PopoverContent,
    PopoverTrigger
} from "@app/components/ui/popover";
import { cn } from "@app/lib/cn";
import { dataTableFilterPopoverContentClassName } from "@app/lib/dataTableFilterPopover";
import { orgQueries } from "@app/lib/queries";
import { useQuery } from "@tanstack/react-query";
import { Funnel } from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { LabelBadge } from "./label-badge";
import { LabelOverflowBadge } from "./label-overflow-badge";
import { LabelsFilterSelector } from "./LabelsFilterSelector";
import { LABEL_COLORS } from "./labels-selector";

function areSelectionsEqual(a: string[], b: string[]) {
    if (a.length !== b.length) {
        return false;
    }
    const setB = new Set(b);
    return a.every((value) => setB.has(value));
}

type LabelColumnFilterButtonProps = {
    selectedValues: string[];
    onSelectedValuesChange: (values: string[]) => void;
    className?: string;
    label: string;
    orgId: string;
};

export function LabelColumnFilterButton({
    selectedValues,
    onSelectedValuesChange,
    className,
    label,
    orgId
}: LabelColumnFilterButtonProps) {
    const [open, setOpen] = useState(false);
    const [draftValues, setDraftValues] = useState<string[]>(selectedValues);
    const t = useTranslations();

    const { data: labels = [] } = useQuery(
        orgQueries.labels({
            orgId,
            perPage: 500
        })
    );

    const draftSet = useMemo(() => new Set(draftValues), [draftValues]);

    const selectedLabels = useMemo(
        () =>
            selectedValues.map((name) => {
                const foundLabel = labels.find((label) => label.name === name);
                return {
                    name,
                    color: foundLabel?.color ?? LABEL_COLORS.gray
                };
            }),
        [selectedValues, labels]
    );

    const summary = useMemo(() => {
        if (selectedLabels.length === 0) {
            return null;
        }

        if (selectedLabels.length === 1) {
            const label = selectedLabels[0];
            return (
                <LabelBadge
                    displayOnly
                    name={label.name}
                    color={label.color}
                    className="shrink-0"
                />
            );
        }

        return (
            <LabelOverflowBadge
                labels={selectedLabels}
                displayOnly
                className="shrink-0"
            />
        );
    }, [selectedLabels]);

    function toggle(value: string) {
        setDraftValues((current) =>
            current.includes(value)
                ? current.filter((v) => v !== value)
                : [...current, value]
        );
    }

    function handleOpenChange(nextOpen: boolean) {
        if (nextOpen) {
            setDraftValues(selectedValues);
            setOpen(true);
            return;
        }

        setOpen(false);
        if (!areSelectionsEqual(draftValues, selectedValues)) {
            onSelectedValuesChange(draftValues);
        }
    }

    return (
        <div className="flex items-center">
            <Popover open={open} onOpenChange={handleOpenChange}>
                <PopoverTrigger asChild>
                    <Button
                        variant="ghost"
                        role="combobox"
                        aria-expanded={open}
                        className={cn(
                            "justify-between text-sm h-8 px-2",
                            selectedValues.length === 0 &&
                                "text-muted-foreground",
                            className
                        )}
                    >
                        <div className="flex items-center gap-2 min-w-0">
                            <span className="shrink-0">{label}</span>
                            <Funnel className="size-4 flex-none shrink-0" />
                            {summary}
                        </div>
                    </Button>
                </PopoverTrigger>
                <PopoverContent
                    className={dataTableFilterPopoverContentClassName}
                    align="start"
                >
                    <LabelsFilterSelector
                        orgId={orgId}
                        isSelected={(label) => draftSet.has(label.name)}
                        onToggle={(label) => {
                            toggle(label.name);
                        }}
                        showClear={draftValues.length > 0}
                        onClear={() => {
                            setDraftValues([]);
                        }}
                    />
                </PopoverContent>
            </Popover>
        </div>
    );
}
