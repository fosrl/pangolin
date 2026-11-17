"use client";

import { PaidFeaturesAlert } from "@app/components/PaidFeaturesAlert";
import { SwitchInput } from "@app/components/SwitchInput";
import { Badge } from "@app/components/ui/badge";
import { Checkbox } from "@app/components/ui/checkbox";
import { useEnvContext } from "@app/hooks/useEnvContext";
import { createApiClient } from "@app/lib/api";
import { tierMatrix } from "@server/lib/billing/tierMatrix";
import type {
    ListDnsBlockCategoriesResponse,
    ListDnsBlockListsResponse,
    RoleDnsBlockingValues
} from "@server/routers/dnsBlocking/types";
import { useQuery } from "@tanstack/react-query";
import type { AxiosResponse } from "axios";
import { useTranslations } from "next-intl";
import Link from "next/link";

export const defaultRoleDnsBlocking: RoleDnsBlockingValues = {
    enabled: false,
    categories: [],
    listIds: []
};

export async function saveRoleDnsBlocking(
    api: ReturnType<typeof createApiClient>,
    roleId: number,
    values: RoleDnsBlockingValues
) {
    await api.post(`/role/${roleId}/dns-blocking`, values);
}

type RoleDnsBlockingFieldsProps = {
    orgId: string;
    value: RoleDnsBlockingValues;
    onChange: (value: RoleDnsBlockingValues) => void;
    disabled?: boolean;
};

export function RoleDnsBlockingFields({
    orgId,
    value,
    onChange,
    disabled = false
}: RoleDnsBlockingFieldsProps) {
    const t = useTranslations();
    const api = createApiClient(useEnvContext());

    // Ads and malware blocking is open to everyone; the other categories and
    // custom lists need a license, and the server says which the org has.
    const categoriesQuery = useQuery({
        queryKey: ["ORG", orgId, "DNS_BLOCK_CATEGORIES"] as const,
        queryFn: async ({ signal }) => {
            const res = await api.get<
                AxiosResponse<ListDnsBlockCategoriesResponse>
            >(`/org/${orgId}/dns-block-categories`, { signal });
            return res.data.data;
        }
    });
    const customListsAvailable =
        categoriesQuery.data?.customListsAvailable ?? false;

    const listsQuery = useQuery({
        queryKey: ["ORG", orgId, "DNS_BLOCK_LISTS"] as const,
        queryFn: async ({ signal }) => {
            const res = await api.get<AxiosResponse<ListDnsBlockListsResponse>>(
                `/org/${orgId}/dns-block-lists`,
                { signal }
            );
            return res.data.data.lists;
        },
        enabled: customListsAvailable
    });

    const fieldsDisabled = disabled || !value.enabled;
    const lists = customListsAvailable ? (listsQuery.data ?? []) : [];

    function toggle<T>(items: T[], item: T, checked: boolean): T[] {
        const without = items.filter((i) => i !== item);
        return checked ? [...without, item] : without;
    }

    function categoryLabel(id: string): { name: string; description: string } {
        switch (id) {
            case "ads":
                return {
                    name: t("dnsBlockCategoryAds"),
                    description: t("dnsBlockCategoryAdsDescription")
                };
            case "fakenews":
                return {
                    name: t("dnsBlockCategoryFakenews"),
                    description: t("dnsBlockCategoryFakenewsDescription")
                };
            case "gambling":
                return {
                    name: t("dnsBlockCategoryGambling"),
                    description: t("dnsBlockCategoryGamblingDescription")
                };
            case "adult":
                return {
                    name: t("dnsBlockCategoryAdult"),
                    description: t("dnsBlockCategoryAdultDescription")
                };
            case "social":
                return {
                    name: t("dnsBlockCategorySocial"),
                    description: t("dnsBlockCategorySocialDescription")
                };
            default:
                return { name: id, description: "" };
        }
    }

    return (
        <div className="space-y-6">
            {(!customListsAvailable ||
                (categoriesQuery.data?.categories ?? []).some(
                    (c) => !c.available
                )) && <PaidFeaturesAlert tiers={tierMatrix.dnsBlocking} />}

            <SwitchInput
                id="dns-blocking-enabled"
                label={t("dnsBlockingEnabled")}
                description={t("dnsBlockingEnabledDescription")}
                checked={value.enabled}
                disabled={disabled}
                onCheckedChange={(enabled) => onChange({ ...value, enabled })}
            />

            <div className="space-y-3">
                <div>
                    <div className="text-sm font-medium">
                        {t("dnsBlockingCategories")}
                    </div>
                    <p className="text-sm text-muted-foreground">
                        {t("dnsBlockingCategoriesDescription")}
                    </p>
                </div>
                <div className="space-y-3">
                    {(categoriesQuery.data?.categories ?? []).map(
                        (category) => {
                            const label = categoryLabel(category.id);
                            const id = `dns-block-category-${category.id}`;
                            return (
                                <div
                                    key={category.id}
                                    className="flex items-start gap-3"
                                >
                                    <Checkbox
                                        id={id}
                                        className="mt-0.5"
                                        checked={value.categories.includes(
                                            category.id
                                        )}
                                        disabled={
                                            fieldsDisabled ||
                                            !category.available
                                        }
                                        onCheckedChange={(checked) =>
                                            onChange({
                                                ...value,
                                                categories: toggle(
                                                    value.categories,
                                                    category.id,
                                                    checked === true
                                                )
                                            })
                                        }
                                    />
                                    <label htmlFor={id} className="space-y-0.5">
                                        <div className="text-sm font-medium leading-none">
                                            {label.name}
                                            {!category.available && (
                                                <Badge
                                                    variant="outlinePrimary"
                                                    className="ml-2"
                                                >
                                                    {t("dnsBlockingPaidBadge")}
                                                </Badge>
                                            )}
                                            <span className="ml-2 font-normal text-muted-foreground">
                                                {t("dnsBlockListDomainCount", {
                                                    count: category.domainCount
                                                })}
                                            </span>
                                        </div>
                                        <div className="text-sm text-muted-foreground">
                                            {label.description}
                                        </div>
                                    </label>
                                </div>
                            );
                        }
                    )}
                </div>
            </div>

            <div className="space-y-3">
                <div className="flex items-start justify-between gap-4">
                    <div>
                        <div className="text-sm font-medium">
                            {t("dnsBlockingCustomLists")}
                            {!customListsAvailable && (
                                <Badge
                                    variant="outlinePrimary"
                                    className="ml-2"
                                >
                                    {t("dnsBlockingPaidBadge")}
                                </Badge>
                            )}
                        </div>
                        <p className="text-sm text-muted-foreground">
                            {t("dnsBlockingCustomListsDescription")}
                        </p>
                    </div>
                    <Link
                        href={`/${orgId}/settings/dns-blocking`}
                        className="shrink-0 text-sm text-primary hover:underline"
                    >
                        {t("dnsBlockingManageLists")}
                    </Link>
                </div>
                {lists.length === 0 && !listsQuery.isLoading ? (
                    <p className="text-sm text-muted-foreground">
                        {t("dnsBlockingNoCustomLists")}
                    </p>
                ) : (
                    <div className="space-y-3">
                        {lists.map((list) => {
                            const id = `dns-block-list-${list.dnsBlockListId}`;
                            return (
                                <div
                                    key={list.dnsBlockListId}
                                    className="flex items-center gap-3"
                                >
                                    <Checkbox
                                        id={id}
                                        checked={value.listIds.includes(
                                            list.dnsBlockListId
                                        )}
                                        disabled={fieldsDisabled}
                                        onCheckedChange={(checked) =>
                                            onChange({
                                                ...value,
                                                listIds: toggle(
                                                    value.listIds,
                                                    list.dnsBlockListId,
                                                    checked === true
                                                )
                                            })
                                        }
                                    />
                                    <label
                                        htmlFor={id}
                                        className="text-sm font-medium leading-none"
                                    >
                                        {list.name}
                                        <span className="ml-2 font-normal text-muted-foreground">
                                            {t("dnsBlockListDomainCount", {
                                                count: list.domainCount
                                            })}
                                        </span>
                                    </label>
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>
        </div>
    );
}
