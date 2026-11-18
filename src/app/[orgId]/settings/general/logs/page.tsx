"use client";
import { Button } from "@app/components/ui/button";
import { useOrgContext } from "@app/hooks/useOrgContext";
import { toast } from "@app/hooks/useToast";
import {
    useActionState,
    startTransition
} from "react";
import {
    Form,
    FormControl,
    FormDescription,
    FormField,
    FormItem,
    FormLabel,
    FormMessage
} from "@/components/ui/form";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue
} from "@/components/ui/select";

import { z } from "zod";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { createApiClient } from "@app/lib/api";
import { useEnvContext } from "@app/hooks/useEnvContext";
import { formatAxiosError } from "@app/lib/api";
import { useRouter } from "next/navigation";
import {
    SettingsContainer,
    SettingsSection,
    SettingsSectionHeader,
    SettingsSectionTitle,
    SettingsSectionDescription,
    SettingsSectionBody,
    SettingsSectionForm,
    SettingsSectionFooter,
    SettingsFormGrid,
    SettingsFormCell
} from "@app/components/Settings";
import { useTranslations } from "next-intl";
import { build } from "@server/build";
import { PaidFeaturesAlert } from "@app/components/PaidFeaturesAlert";
import { usePaidStatus } from "@app/hooks/usePaidStatus";
import type { OrgContextType } from "@app/contexts/orgContext";
import { tierMatrix } from "@server/lib/billing/tierMatrix";

const LogRetentionFormSchema = z.object({
    settingsLogRetentionDaysRequest: z.number(),
    settingsLogRetentionDaysAccess: z.number(),
    settingsLogRetentionDaysAction: z.number(),
    settingsLogRetentionDaysConnection: z.number(),
    settingsLogRetentionDaysAISessions: z.number(),
    settingsLogRetentionDaysSsh: z.number()
});

const LOG_RETENTION_OPTIONS = [
    { label: "logRetentionDisabled", value: 0 },
    { label: "logRetention3Days", value: 3 },
    { label: "logRetention7Days", value: 7 },
    { label: "logRetention14Days", value: 14 },
    { label: "logRetention30Days", value: 30 },
    { label: "logRetention90Days", value: 90 },
    ...(build != "saas"
        ? [
              { label: "logRetentionForever", value: -1 },
              { label: "logRetentionEndOfFollowingYear", value: 9001 }
          ]
        : [])
];

type SectionFormProps = {
    org: OrgContextType["org"]["org"];
};

export default function LogsSettingsPage() {
    const { org } = useOrgContext();
    return (
        <SettingsContainer>
            <LogRetentionSectionForm org={org.org} />
        </SettingsContainer>
    );
}

function LogRetentionSectionForm({ org }: SectionFormProps) {
    const { updateOrg } = useOrgContext();
    const form = useForm({
        resolver: zodResolver(
            LogRetentionFormSchema.pick({
                settingsLogRetentionDaysRequest: true,
                settingsLogRetentionDaysAccess: true,
                settingsLogRetentionDaysAction: true,
                settingsLogRetentionDaysConnection: true,
                settingsLogRetentionDaysAISessions: true,
                settingsLogRetentionDaysSsh: true
            })
        ),
        defaultValues: {
            settingsLogRetentionDaysRequest:
                org.settingsLogRetentionDaysRequest ?? 15,
            settingsLogRetentionDaysAccess:
                org.settingsLogRetentionDaysAccess ?? 15,
            settingsLogRetentionDaysAction:
                org.settingsLogRetentionDaysAction ?? 15,
            settingsLogRetentionDaysConnection:
                org.settingsLogRetentionDaysConnection ?? 15,
            settingsLogRetentionDaysAISessions:
                org.settingsLogRetentionDaysAISessions ?? 15,
            settingsLogRetentionDaysSsh: org.settingsLogRetentionDaysSsh ?? 15
        },
        mode: "onChange"
    });

    const router = useRouter();
    const t = useTranslations();
    const {
        isPaidUser,
        subscriptionTier,
        hasSaasSubscription,
        hasEnterpriseLicense
    } = usePaidStatus();
    const showAccessLogsAlert =
        (build === "saas" && !hasSaasSubscription(tierMatrix.accessLogs)) ||
        ((build === "enterprise" || build === "oss") && !hasEnterpriseLicense);

    const [, formAction, loadingSave] = useActionState(performSave, null);
    const { env } = useEnvContext();
    const api = createApiClient({ env });

    async function performSave() {
        const isValid = await form.trigger();
        if (!isValid) return;

        const data = form.getValues();

        try {
            const reqData = {
                settingsLogRetentionDaysRequest:
                    data.settingsLogRetentionDaysRequest,
                settingsLogRetentionDaysAccess:
                    data.settingsLogRetentionDaysAccess,
                settingsLogRetentionDaysAction:
                    data.settingsLogRetentionDaysAction,
                settingsLogRetentionDaysConnection:
                    data.settingsLogRetentionDaysConnection,
                settingsLogRetentionDaysAISessions:
                    data.settingsLogRetentionDaysAISessions,
                settingsLogRetentionDaysSsh: data.settingsLogRetentionDaysSsh
            } as any;

            // Update organization
            await api.post(`/org/${org.orgId}`, reqData);

            // Update the org context immediately so the dropdowns reflect
            // the saved values without waiting on a re-fetch that could
            // race a lagging read replica
            updateOrg(reqData);

            toast({
                title: t("orgUpdated"),
                description: t("orgUpdatedDescription")
            });
            router.refresh();
        } catch (e) {
            toast({
                variant: "destructive",
                title: t("orgErrorUpdate"),
                description: formatAxiosError(e, t("orgErrorUpdateMessage"))
            });
        }
    }

    return (
        <SettingsSection>
            <SettingsSectionHeader>
                <SettingsSectionTitle>{t("logRetention")}</SettingsSectionTitle>
                <SettingsSectionDescription>
                    {t("logRetentionDescription")}
                </SettingsSectionDescription>
            </SettingsSectionHeader>
            <SettingsSectionBody>
                <SettingsSectionForm variant="half">
                    <Form {...form}>
                        <form
                            onSubmit={(e) => {
                                e.preventDefault();
                                startTransition(() => {
                                    formAction();
                                });
                            }}
                            id="org-log-retention-settings-form"
                            className="space-y-4"
                        >
                            {!env.flags.disableEnterpriseFeatures &&
                                showAccessLogsAlert && (
                                    <div className="[&>*]:mb-0">
                                        <PaidFeaturesAlert
                                            tiers={tierMatrix.accessLogs}
                                        />
                                    </div>
                                )}
                            <SettingsFormGrid>
                                <SettingsFormCell span="half">
                                    <FormField
                                        control={form.control}
                                        name="settingsLogRetentionDaysRequest"
                                        render={({ field }) => (
                                            <FormItem>
                                                <FormLabel>
                                                    {t(
                                                        "logRetentionRequestLabel"
                                                    )}
                                                </FormLabel>
                                                <FormControl>
                                                    <Select
                                                        value={field.value.toString()}
                                                        onValueChange={(
                                                            value
                                                        ) =>
                                                            field.onChange(
                                                                parseInt(
                                                                    value,
                                                                    10
                                                                )
                                                            )
                                                        }
                                                    >
                                                        <SelectTrigger>
                                                            <SelectValue
                                                                placeholder={t(
                                                                    "selectLogRetention"
                                                                )}
                                                            />
                                                        </SelectTrigger>
                                                        <SelectContent>
                                                            {LOG_RETENTION_OPTIONS.filter(
                                                                (option) => {
                                                                    if (
                                                                        build !=
                                                                        "saas"
                                                                    ) {
                                                                        return true;
                                                                    }

                                                                    let maxDays: number;

                                                                    if (
                                                                        !subscriptionTier
                                                                    ) {
                                                                        // No tier
                                                                        maxDays = 3;
                                                                    } else if (
                                                                        subscriptionTier ==
                                                                        "enterprise"
                                                                    ) {
                                                                        // Enterprise - no limit
                                                                        return true;
                                                                    } else if (
                                                                        subscriptionTier ==
                                                                        "tier3"
                                                                    ) {
                                                                        maxDays = 90;
                                                                    } else if (
                                                                        subscriptionTier ==
                                                                        "tier2"
                                                                    ) {
                                                                        maxDays = 30;
                                                                    } else if (
                                                                        subscriptionTier ==
                                                                        "tier1"
                                                                    ) {
                                                                        maxDays = 7;
                                                                    } else {
                                                                        // Default to most restrictive
                                                                        maxDays = 3;
                                                                    }

                                                                    // Filter out options that exceed the max
                                                                    // Special values: -1 (forever) and 9001 (end of year) should be filtered
                                                                    if (
                                                                        option.value <
                                                                            0 ||
                                                                        option.value >
                                                                            maxDays
                                                                    ) {
                                                                        return false;
                                                                    }

                                                                    return true;
                                                                }
                                                            ).map((option) => (
                                                                <SelectItem
                                                                    key={
                                                                        option.value
                                                                    }
                                                                    value={option.value.toString()}
                                                                >
                                                                    {t(
                                                                        option.label
                                                                    )}
                                                                </SelectItem>
                                                            ))}
                                                        </SelectContent>
                                                    </Select>
                                                </FormControl>
                                                <FormMessage />
                                            </FormItem>
                                        )}
                                    />
                                </SettingsFormCell>

                                {!env.flags.disableEnterpriseFeatures && (
                                    <>
                                        <SettingsFormCell span="half">
                                            <FormField
                                                control={form.control}
                                                name="settingsLogRetentionDaysAccess"
                                                render={({ field }) => {
                                                    const isDisabled =
                                                        !isPaidUser(
                                                            tierMatrix.accessLogs
                                                        );

                                                    return (
                                                        <FormItem>
                                                            <FormLabel>
                                                                {t(
                                                                    "logRetentionAccessLabel"
                                                                )}
                                                            </FormLabel>
                                                            <FormControl>
                                                                <Select
                                                                    value={field.value.toString()}
                                                                    onValueChange={(
                                                                        value
                                                                    ) => {
                                                                        if (
                                                                            !isDisabled
                                                                        ) {
                                                                            field.onChange(
                                                                                parseInt(
                                                                                    value,
                                                                                    10
                                                                                )
                                                                            );
                                                                        }
                                                                    }}
                                                                    disabled={
                                                                        isDisabled
                                                                    }
                                                                >
                                                                    <SelectTrigger>
                                                                        <SelectValue
                                                                            placeholder={t(
                                                                                "selectLogRetention"
                                                                            )}
                                                                        />
                                                                    </SelectTrigger>
                                                                    <SelectContent>
                                                                        {LOG_RETENTION_OPTIONS.filter(
                                                                            (
                                                                                option
                                                                            ) => {
                                                                                if (
                                                                                    build !=
                                                                                    "saas"
                                                                                ) {
                                                                                    return true;
                                                                                }

                                                                                let maxDays: number;

                                                                                if (
                                                                                    !subscriptionTier
                                                                                ) {
                                                                                    // No tier
                                                                                    maxDays = 3;
                                                                                } else if (
                                                                                    subscriptionTier ==
                                                                                    "enterprise"
                                                                                ) {
                                                                                    // Enterprise - no limit
                                                                                    return true;
                                                                                } else if (
                                                                                    subscriptionTier ==
                                                                                    "tier3"
                                                                                ) {
                                                                                    maxDays = 90;
                                                                                } else if (
                                                                                    subscriptionTier ==
                                                                                    "tier2"
                                                                                ) {
                                                                                    maxDays = 30;
                                                                                } else if (
                                                                                    subscriptionTier ==
                                                                                    "tier1"
                                                                                ) {
                                                                                    maxDays = 7;
                                                                                } else {
                                                                                    // Default to most restrictive
                                                                                    maxDays = 3;
                                                                                }

                                                                                // Filter out options that exceed the max
                                                                                // Special values: -1 (forever) and 9001 (end of year) should be filtered
                                                                                if (
                                                                                    option.value <
                                                                                        0 ||
                                                                                    option.value >
                                                                                        maxDays
                                                                                ) {
                                                                                    return false;
                                                                                }

                                                                                return true;
                                                                            }
                                                                        ).map(
                                                                            (
                                                                                option
                                                                            ) => (
                                                                                <SelectItem
                                                                                    key={
                                                                                        option.value
                                                                                    }
                                                                                    value={option.value.toString()}
                                                                                >
                                                                                    {t(
                                                                                        option.label
                                                                                    )}
                                                                                </SelectItem>
                                                                            )
                                                                        )}
                                                                    </SelectContent>
                                                                </Select>
                                                            </FormControl>
                                                            <FormMessage />
                                                        </FormItem>
                                                    );
                                                }}
                                            />
                                        </SettingsFormCell>
                                        <SettingsFormCell span="half">
                                            <FormField
                                                control={form.control}
                                                name="settingsLogRetentionDaysAction"
                                                render={({ field }) => {
                                                    const isDisabled =
                                                        !isPaidUser(
                                                            tierMatrix.actionLogs
                                                        );

                                                    return (
                                                        <FormItem>
                                                            <FormLabel>
                                                                {t(
                                                                    "logRetentionActionLabel"
                                                                )}
                                                            </FormLabel>
                                                            <FormControl>
                                                                <Select
                                                                    value={field.value.toString()}
                                                                    onValueChange={(
                                                                        value
                                                                    ) => {
                                                                        if (
                                                                            !isDisabled
                                                                        ) {
                                                                            field.onChange(
                                                                                parseInt(
                                                                                    value,
                                                                                    10
                                                                                )
                                                                            );
                                                                        }
                                                                    }}
                                                                    disabled={
                                                                        isDisabled
                                                                    }
                                                                >
                                                                    <SelectTrigger>
                                                                        <SelectValue
                                                                            placeholder={t(
                                                                                "selectLogRetention"
                                                                            )}
                                                                        />
                                                                    </SelectTrigger>
                                                                    <SelectContent>
                                                                        {LOG_RETENTION_OPTIONS.filter(
                                                                            (
                                                                                option
                                                                            ) => {
                                                                                if (
                                                                                    build !=
                                                                                    "saas"
                                                                                ) {
                                                                                    return true;
                                                                                }

                                                                                let maxDays: number;

                                                                                if (
                                                                                    !subscriptionTier
                                                                                ) {
                                                                                    // No tier
                                                                                    maxDays = 3;
                                                                                } else if (
                                                                                    subscriptionTier ==
                                                                                    "enterprise"
                                                                                ) {
                                                                                    // Enterprise - no limit
                                                                                    return true;
                                                                                } else if (
                                                                                    subscriptionTier ==
                                                                                    "tier3"
                                                                                ) {
                                                                                    maxDays = 90;
                                                                                } else if (
                                                                                    subscriptionTier ==
                                                                                    "tier2"
                                                                                ) {
                                                                                    maxDays = 30;
                                                                                } else if (
                                                                                    subscriptionTier ==
                                                                                    "tier1"
                                                                                ) {
                                                                                    maxDays = 7;
                                                                                } else {
                                                                                    // Default to most restrictive
                                                                                    maxDays = 3;
                                                                                }

                                                                                // Filter out options that exceed the max
                                                                                // Special values: -1 (forever) and 9001 (end of year) should be filtered
                                                                                if (
                                                                                    option.value <
                                                                                        0 ||
                                                                                    option.value >
                                                                                        maxDays
                                                                                ) {
                                                                                    return false;
                                                                                }

                                                                                return true;
                                                                            }
                                                                        ).map(
                                                                            (
                                                                                option
                                                                            ) => (
                                                                                <SelectItem
                                                                                    key={
                                                                                        option.value
                                                                                    }
                                                                                    value={option.value.toString()}
                                                                                >
                                                                                    {t(
                                                                                        option.label
                                                                                    )}
                                                                                </SelectItem>
                                                                            )
                                                                        )}
                                                                    </SelectContent>
                                                                </Select>
                                                            </FormControl>
                                                            <FormMessage />
                                                        </FormItem>
                                                    );
                                                }}
                                            />
                                        </SettingsFormCell>
                                        <SettingsFormCell span="half">
                                            <FormField
                                                control={form.control}
                                                name="settingsLogRetentionDaysConnection"
                                                render={({ field }) => {
                                                    const isDisabled =
                                                        !isPaidUser(
                                                            tierMatrix.connectionLogs
                                                        );

                                                    return (
                                                        <FormItem>
                                                            <FormLabel>
                                                                {t(
                                                                    "logRetentionConnectionLabel"
                                                                )}
                                                            </FormLabel>
                                                            <FormControl>
                                                                <Select
                                                                    value={field.value.toString()}
                                                                    onValueChange={(
                                                                        value
                                                                    ) => {
                                                                        if (
                                                                            !isDisabled
                                                                        ) {
                                                                            field.onChange(
                                                                                parseInt(
                                                                                    value,
                                                                                    10
                                                                                )
                                                                            );
                                                                        }
                                                                    }}
                                                                    disabled={
                                                                        isDisabled
                                                                    }
                                                                >
                                                                    <SelectTrigger>
                                                                        <SelectValue
                                                                            placeholder={t(
                                                                                "selectLogRetention"
                                                                            )}
                                                                        />
                                                                    </SelectTrigger>
                                                                    <SelectContent>
                                                                        {LOG_RETENTION_OPTIONS.filter(
                                                                            (
                                                                                option
                                                                            ) => {
                                                                                if (
                                                                                    build !=
                                                                                    "saas"
                                                                                ) {
                                                                                    return true;
                                                                                }

                                                                                let maxDays: number;

                                                                                if (
                                                                                    !subscriptionTier
                                                                                ) {
                                                                                    // No tier
                                                                                    maxDays = 3;
                                                                                } else if (
                                                                                    subscriptionTier ==
                                                                                    "enterprise"
                                                                                ) {
                                                                                    // Enterprise - no limit
                                                                                    return true;
                                                                                } else if (
                                                                                    subscriptionTier ==
                                                                                    "tier3"
                                                                                ) {
                                                                                    maxDays = 90;
                                                                                } else if (
                                                                                    subscriptionTier ==
                                                                                    "tier2"
                                                                                ) {
                                                                                    maxDays = 30;
                                                                                } else if (
                                                                                    subscriptionTier ==
                                                                                    "tier1"
                                                                                ) {
                                                                                    maxDays = 7;
                                                                                } else {
                                                                                    // Default to most restrictive
                                                                                    maxDays = 3;
                                                                                }

                                                                                // Filter out options that exceed the max
                                                                                // Special values: -1 (forever) and 9001 (end of year) should be filtered
                                                                                if (
                                                                                    option.value <
                                                                                        0 ||
                                                                                    option.value >
                                                                                        maxDays
                                                                                ) {
                                                                                    return false;
                                                                                }

                                                                                return true;
                                                                            }
                                                                        ).map(
                                                                            (
                                                                                option
                                                                            ) => (
                                                                                <SelectItem
                                                                                    key={
                                                                                        option.value
                                                                                    }
                                                                                    value={option.value.toString()}
                                                                                >
                                                                                    {t(
                                                                                        option.label
                                                                                    )}
                                                                                </SelectItem>
                                                                            )
                                                                        )}
                                                                    </SelectContent>
                                                                </Select>
                                                            </FormControl>
                                                            <FormMessage />
                                                        </FormItem>
                                                    );
                                                }}
                                            />
                                        </SettingsFormCell>
                                        <SettingsFormCell span="half">
                                            <FormField
                                                control={form.control}
                                                name="settingsLogRetentionDaysAISessions"
                                                render={({ field }) => {
                                                    const isDisabled =
                                                        !isPaidUser(
                                                            tierMatrix.aiSessionLogs
                                                        );

                                                    return (
                                                        <FormItem>
                                                            <FormLabel>
                                                                {t(
                                                                    "logRetentionAISessionsLabel"
                                                                )}
                                                            </FormLabel>
                                                            <FormControl>
                                                                <Select
                                                                    value={field.value.toString()}
                                                                    onValueChange={(
                                                                        value
                                                                    ) => {
                                                                        if (
                                                                            !isDisabled
                                                                        ) {
                                                                            field.onChange(
                                                                                parseInt(
                                                                                    value,
                                                                                    10
                                                                                )
                                                                            );
                                                                        }
                                                                    }}
                                                                    disabled={
                                                                        isDisabled
                                                                    }
                                                                >
                                                                    <SelectTrigger>
                                                                        <SelectValue
                                                                            placeholder={t(
                                                                                "selectLogRetention"
                                                                            )}
                                                                        />
                                                                    </SelectTrigger>
                                                                    <SelectContent>
                                                                        {LOG_RETENTION_OPTIONS.filter(
                                                                            (
                                                                                option
                                                                            ) => {
                                                                                if (
                                                                                    build !=
                                                                                    "saas"
                                                                                ) {
                                                                                    return true;
                                                                                }

                                                                                let maxDays: number;

                                                                                if (
                                                                                    !subscriptionTier
                                                                                ) {
                                                                                    // No tier
                                                                                    maxDays = 3;
                                                                                } else if (
                                                                                    subscriptionTier ==
                                                                                    "enterprise"
                                                                                ) {
                                                                                    // Enterprise - no limit
                                                                                    return true;
                                                                                } else if (
                                                                                    subscriptionTier ==
                                                                                    "tier3"
                                                                                ) {
                                                                                    maxDays = 90;
                                                                                } else if (
                                                                                    subscriptionTier ==
                                                                                    "tier2"
                                                                                ) {
                                                                                    maxDays = 30;
                                                                                } else if (
                                                                                    subscriptionTier ==
                                                                                    "tier1"
                                                                                ) {
                                                                                    maxDays = 7;
                                                                                } else {
                                                                                    // Default to most restrictive
                                                                                    maxDays = 3;
                                                                                }

                                                                                // Filter out options that exceed the max
                                                                                // Special values: -1 (forever) and 9001 (end of year) should be filtered
                                                                                if (
                                                                                    option.value <
                                                                                        0 ||
                                                                                    option.value >
                                                                                        maxDays
                                                                                ) {
                                                                                    return false;
                                                                                }

                                                                                return true;
                                                                            }
                                                                        ).map(
                                                                            (
                                                                                option
                                                                            ) => (
                                                                                <SelectItem
                                                                                    key={
                                                                                        option.value
                                                                                    }
                                                                                    value={option.value.toString()}
                                                                                >
                                                                                    {t(
                                                                                        option.label
                                                                                    )}
                                                                                </SelectItem>
                                                                            )
                                                                        )}
                                                                    </SelectContent>
                                                                </Select>
                                                            </FormControl>
                                                            <FormMessage />
                                                        </FormItem>
                                                    );
                                                }}
                                            />
                                        </SettingsFormCell>
                                        <SettingsFormCell span="half">
                                            <FormField
                                                control={form.control}
                                                name="settingsLogRetentionDaysSsh"
                                                render={({ field }) => {
                                                    const isDisabled =
                                                        !isPaidUser(
                                                            tierMatrix.sshSessionLogs
                                                        );

                                                    return (
                                                        <FormItem>
                                                            <FormLabel>
                                                                {t(
                                                                    "logRetentionSshLabel"
                                                                )}
                                                            </FormLabel>
                                                            <FormControl>
                                                                <Select
                                                                    value={field.value.toString()}
                                                                    onValueChange={(
                                                                        value
                                                                    ) => {
                                                                        if (
                                                                            !isDisabled
                                                                        ) {
                                                                            field.onChange(
                                                                                parseInt(
                                                                                    value,
                                                                                    10
                                                                                )
                                                                            );
                                                                        }
                                                                    }}
                                                                    disabled={
                                                                        isDisabled
                                                                    }
                                                                >
                                                                    <SelectTrigger>
                                                                        <SelectValue
                                                                            placeholder={t(
                                                                                "selectLogRetention"
                                                                            )}
                                                                        />
                                                                    </SelectTrigger>
                                                                    <SelectContent>
                                                                        {LOG_RETENTION_OPTIONS.filter(
                                                                            (
                                                                                option
                                                                            ) => {
                                                                                if (
                                                                                    build !=
                                                                                    "saas"
                                                                                ) {
                                                                                    return true;
                                                                                }

                                                                                let maxDays: number;

                                                                                if (
                                                                                    !subscriptionTier
                                                                                ) {
                                                                                    // No tier
                                                                                    maxDays = 3;
                                                                                } else if (
                                                                                    subscriptionTier ==
                                                                                    "enterprise"
                                                                                ) {
                                                                                    // Enterprise - no limit
                                                                                    return true;
                                                                                } else if (
                                                                                    subscriptionTier ==
                                                                                    "tier3"
                                                                                ) {
                                                                                    maxDays = 90;
                                                                                } else if (
                                                                                    subscriptionTier ==
                                                                                    "tier2"
                                                                                ) {
                                                                                    maxDays = 30;
                                                                                } else if (
                                                                                    subscriptionTier ==
                                                                                    "tier1"
                                                                                ) {
                                                                                    maxDays = 7;
                                                                                } else {
                                                                                    // Default to most restrictive
                                                                                    maxDays = 3;
                                                                                }

                                                                                // Filter out options that exceed the max
                                                                                // Special values: -1 (forever) and 9001 (end of year) should be filtered
                                                                                if (
                                                                                    option.value <
                                                                                        0 ||
                                                                                    option.value >
                                                                                        maxDays
                                                                                ) {
                                                                                    return false;
                                                                                }

                                                                                return true;
                                                                            }
                                                                        ).map(
                                                                            (
                                                                                option
                                                                            ) => (
                                                                                <SelectItem
                                                                                    key={
                                                                                        option.value
                                                                                    }
                                                                                    value={option.value.toString()}
                                                                                >
                                                                                    {t(
                                                                                        option.label
                                                                                    )}
                                                                                </SelectItem>
                                                                            )
                                                                        )}
                                                                    </SelectContent>
                                                                </Select>
                                                            </FormControl>
                                                            <FormMessage />
                                                        </FormItem>
                                                    );
                                                }}
                                            />
                                        </SettingsFormCell>
                                    </>
                                )}
                            </SettingsFormGrid>
                        </form>
                    </Form>
                </SettingsSectionForm>
            </SettingsSectionBody>

            <SettingsSectionFooter>
                <Button
                    type="submit"
                    form="org-log-retention-settings-form"
                    loading={loadingSave}
                    disabled={loadingSave}
                >
                    {t("saveSettings")}
                </Button>
            </SettingsSectionFooter>
        </SettingsSection>
    );
}
