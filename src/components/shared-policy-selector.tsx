"use client";

import { orgQueries } from "@app/lib/queries";
import { cn } from "@app/lib/cn";
import type { ListResourcePoliciesResponse } from "@server/routers/resource/types";
import { useQuery } from "@tanstack/react-query";
import { CheckIcon, ChevronsUpDown } from "lucide-react";
import { useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import { useDebounce } from "use-debounce";
import { Button } from "./ui/button";
import {
    Command,
    CommandEmpty,
    CommandGroup,
    CommandInput,
    CommandItem,
    CommandList
} from "./ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";

export type SelectedSharedPolicy = Pick<
    ListResourcePoliciesResponse["policies"][number],
    "resourcePolicyId" | "name"
>;

export type SharedPolicySelectorProps = {
    orgId: string;
    selectedPolicy: SelectedSharedPolicy | null;
    onSelectPolicy: (policy: SelectedSharedPolicy | null) => void;
};

export function SharedPolicySelector({
    orgId,
    selectedPolicy,
    onSelectPolicy
}: SharedPolicySelectorProps) {
    const t = useTranslations();
    const [policySearchQuery, setPolicySearchQuery] = useState("");
    const [debouncedQuery] = useDebounce(policySearchQuery, 150);

    const { data: policies = [] } = useQuery(
        orgQueries.policies({
            orgId,
            query: debouncedQuery
        })
    );

    const policiesShown = useMemo((): SelectedSharedPolicy[] => {
        const allPolicies: SelectedSharedPolicy[] = policies.map((policy) => ({
            resourcePolicyId: policy.resourcePolicyId,
            name: policy.name
        }));
        if (
            debouncedQuery.trim().length === 0 &&
            selectedPolicy &&
            !allPolicies.find(
                (policy) =>
                    policy.resourcePolicyId === selectedPolicy.resourcePolicyId
            )
        ) {
            allPolicies.unshift(selectedPolicy);
        }
        return allPolicies;
    }, [debouncedQuery, policies, selectedPolicy]);

    return (
        <Command shouldFilter={false}>
            <CommandInput
                placeholder={t("resourcePolicySearch")}
                value={policySearchQuery}
                onValueChange={setPolicySearchQuery}
            />
            <CommandList>
                <CommandEmpty>{t("resourcePolicyNotFound")}</CommandEmpty>
                <CommandGroup>
                    <CommandItem
                        value={`none:${t("none")}`}
                        onSelect={() => onSelectPolicy(null)}
                    >
                        <CheckIcon
                            className={cn(
                                "mr-2 h-4 w-4",
                                selectedPolicy === null
                                    ? "opacity-100"
                                    : "opacity-0"
                            )}
                        />
                        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                            <span className="truncate">{t("none")}</span>
                            <span className="text-muted-foreground text-xs leading-snug">
                                {t("sharedPolicyNoneDescription")}
                            </span>
                        </div>
                    </CommandItem>
                    {policiesShown.map((policy) => (
                        <CommandItem
                            key={policy.resourcePolicyId}
                            value={`${policy.resourcePolicyId}:${policy.name}`}
                            onSelect={() =>
                                onSelectPolicy({
                                    resourcePolicyId: policy.resourcePolicyId,
                                    name: policy.name
                                })
                            }
                        >
                            <CheckIcon
                                className={cn(
                                    "mr-2 h-4 w-4",
                                    policy.resourcePolicyId ===
                                        selectedPolicy?.resourcePolicyId
                                        ? "opacity-100"
                                        : "opacity-0"
                                )}
                            />
                            <span className="min-w-0 flex-1 truncate">
                                {policy.name}
                            </span>
                        </CommandItem>
                    ))}
                </CommandGroup>
            </CommandList>
        </Command>
    );
}

export type SharedPolicySelectProps = {
    orgId: string;
    value: number | null;
    onChange: (value: number | null) => void;
    className?: string;
    disabled?: boolean;
};

export function SharedPolicySelect({
    orgId,
    value,
    onChange,
    className,
    disabled
}: SharedPolicySelectProps) {
    const t = useTranslations();
    const [open, setOpen] = useState(false);
    const [selectedLabel, setSelectedLabel] = useState<{
        resourcePolicyId: number;
        name: string;
    } | null>(null);

    const resolvedLabel =
        selectedLabel?.resourcePolicyId === value ? selectedLabel.name : null;

    const { data: fetchedPolicy } = useQuery({
        ...orgQueries.resourcePolicy({
            resourcePolicyId: value!
        }),
        enabled: value !== null && resolvedLabel === null
    });

    const selectedPolicy = useMemo((): SelectedSharedPolicy | null => {
        if (value === null) {
            return null;
        }

        return {
            resourcePolicyId: value,
            name: resolvedLabel ?? fetchedPolicy?.name ?? ""
        };
    }, [value, resolvedLabel, fetchedPolicy?.name]);

    const triggerLabel =
        value === null
            ? t("none")
            : (resolvedLabel ??
              fetchedPolicy?.name ??
              t("resourcePolicySelect"));

    return (
        <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
                <Button
                    type="button"
                    variant="outline"
                    role="combobox"
                    disabled={disabled}
                    className={cn(
                        "w-full justify-between font-normal",
                        value !== null &&
                            !resolvedLabel &&
                            !fetchedPolicy?.name &&
                            "text-muted-foreground",
                        className
                    )}
                >
                    <span className="truncate">{triggerLabel}</span>
                    <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                </Button>
            </PopoverTrigger>
            <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0">
                <SharedPolicySelector
                    orgId={orgId}
                    selectedPolicy={selectedPolicy}
                    onSelectPolicy={(policy) => {
                        onChange(policy?.resourcePolicyId ?? null);
                        setSelectedLabel(
                            policy
                                ? {
                                      resourcePolicyId: policy.resourcePolicyId,
                                      name: policy.name
                                  }
                                : null
                        );
                        setOpen(false);
                    }}
                />
            </PopoverContent>
        </Popover>
    );
}
