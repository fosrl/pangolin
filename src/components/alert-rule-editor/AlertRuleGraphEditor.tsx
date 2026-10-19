"use client";

import {
    ActionBlock,
    AddActionPanel,
    AlertRuleSourceFields,
    AlertRuleTriggerFields
} from "@app/components/alert-rule-editor/AlertRuleFields";
import { PaidFeaturesAlert } from "@app/components/PaidFeaturesAlert";
import { SettingsContainer } from "@app/components/Settings";
import { SwitchInput } from "@app/components/SwitchInput";
import { Button } from "@app/components/ui/button";
import { Card, CardContent } from "@app/components/ui/card";
import {
    Form,
    FormControl,
    FormDescription,
    FormField,
    FormItem,
    FormLabel,
    FormMessage
} from "@app/components/ui/form";
import { Input } from "@app/components/ui/input";
import { useEnvContext } from "@app/hooks/useEnvContext";
import { toast } from "@app/hooks/useToast";
import {
    buildFormSchema,
    defaultFormValues,
    formValuesToApiPayload,
    type AlertRuleFormValues
} from "@app/lib/alertRuleForm";
import { createApiClient, formatAxiosError } from "@app/lib/api";
import { zodResolver } from "@hookform/resolvers/zod";
import { tierMatrix } from "@server/lib/billing/tierMatrix";
import type { CreateAlertRuleResponse } from "@server/routers/alertRule/types";
import type { AxiosResponse } from "axios";
import { Cog, Flag, Zap, ZapIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useActionState, useMemo, useTransition, type ReactNode } from "react";
import { useFieldArray, useForm, type Resolver } from "react-hook-form";
import { Badge } from "../ui/badge";

const FORM_ID = "alert-rule-form";

type StepAccent = {
    labelClass: string;
    icon: typeof Flag;
};

type AlertRuleGraphEditorProps = {
    orgId: string;
    alertRuleId?: number;
    initialValues: AlertRuleFormValues;
    isNew: boolean;
    disabled?: boolean;
};

function VerticalRuleStep({
    stepNumber,
    isLast,
    title,
    accent,
    children
}: {
    stepNumber: number;
    isLast: boolean;
    title: string;
    accent: StepAccent;
    children: ReactNode;
}) {
    const Icon = accent.icon;
    return (
        <li className="flex gap-4 sm:gap-5">
            <div
                className="flex flex-col items-center gap-0 shrink-0 w-8"
                aria-hidden
            >
                <div className="flex h-8 w-8 items-center justify-center rounded-full border border-border bg-background text-sm text-muted-foreground">
                    {stepNumber}
                </div>
                {!isLast && (
                    <div className="w-px flex-1 min-h-8 my-1 border-l border-dashed border-border" />
                )}
            </div>
            <div
                className={
                    isLast
                        ? "min-w-0 flex-1 space-y-3"
                        : "min-w-0 flex-1 space-y-3 pb-10"
                }
            >
                <div
                    className={`flex items-center gap-2 font-semibold text-base ${accent.labelClass}`}
                >
                    <Icon className="h-5 w-5 shrink-0" aria-hidden />
                    <span>{title}</span>
                </div>
                <div className="rounded-lg border border-border bg-card p-4 sm:p-5">
                    {children}
                </div>
            </div>
        </li>
    );
}

export default function AlertRuleGraphEditor({
    orgId,
    alertRuleId,
    initialValues,
    isNew,
    disabled = false
}: AlertRuleGraphEditorProps) {
    const t = useTranslations();
    const router = useRouter();
    const api = createApiClient(useEnvContext());
    const schema = useMemo(() => buildFormSchema(t), [t]);
    const form = useForm<AlertRuleFormValues>({
        resolver: zodResolver(schema) as Resolver<AlertRuleFormValues>,
        defaultValues: initialValues ?? defaultFormValues()
    });

    const { fields, append, remove, update } = useFieldArray({
        control: form.control,
        name: "actions"
    });

    const saveAlert = async () => {
        const isValid = await form.trigger();
        if (!isValid) {
            const values = form.getValues();
            if (values.actions.length === 0) {
                toast({
                    variant: "warning",
                    title: t("alertingNoActionsTitle"),
                    description: t("alertingNoActionsSaveDescription")
                });
            }
            return;
        }

        const values = form.getValues();

        try {
            const payload = formValuesToApiPayload(values);
            if (isNew) {
                const res = await api.put<
                    AxiosResponse<CreateAlertRuleResponse>
                >(`/org/${orgId}/alert-rule`, payload);
                toast({
                    title: t("alertingRuleSaved"),
                    description: t("alertingRuleSavedCreatedDescription")
                });
                router.replace(
                    `/${orgId}/settings/alerting/${res.data.data.alertRuleId}`
                );
            } else {
                await api.post(
                    `/org/${orgId}/alert-rule/${alertRuleId}`,
                    payload
                );
                toast({
                    title: t("alertingRuleSaved"),
                    description: t("alertingRuleSavedUpdatedDescription")
                });
            }
        } catch (e) {
            toast({
                title: t("error"),
                description: formatAxiosError(e),
                variant: "destructive"
            });
        }
    };

    const testAlert = async () => {
        const isValid = await form.trigger("actions");
        const values = form.getValues();

        if (!isValid) {
            if (values.actions.length === 0) {
                toast({
                    variant: "warning",
                    title: t("alertingNoActionsTitle"),
                    description: t("alertingNoActionsTestDescription")
                });
            }

            return;
        }

        try {
            const payload = formValuesToApiPayload(values);
            await api.post(`/org/${orgId}/test-alert-rule`, payload);

            toast({
                title: t("alertingTestAlertSent"),
                description: t("alertingTestAlertSentDescription")
            });
        } catch (e) {
            toast({
                title: t("error"),
                description: formatAxiosError(e),
                variant: "destructive"
            });
        }
    };

    const [, formAction, isSaving] = useActionState(saveAlert, null);
    const [isTestingAlert, startTransition] = useTransition();

    return (
        <Form {...form}>
            <form
                id={FORM_ID}
                onSubmit={(e) => {
                    e.preventDefault();
                    startTransition(() => {
                        formAction();
                    });
                }}
            >
                <SettingsContainer>
                    <PaidFeaturesAlert tiers={tierMatrix.alertingRules} />
                    <div className="flex flex-col lg:flex-row gap-6 lg:gap-8 items-start">
                        <aside className="w-full lg:w-[min(100%,280px)] shrink-0 lg:sticky lg:top-16 space-y-4">
                            <Card>
                                <CardContent className="p-4 sm:p-5 space-y-4">
                                    <fieldset
                                        disabled={disabled}
                                        className={`space-y-4${disabled ? " opacity-50 pointer-events-none" : ""}`}
                                    >
                                        <div className="flex flex-wrap items-center gap-2">
                                            {isNew && (
                                                <Badge variant="secondary">
                                                    {t("alertingDraftBadge")}
                                                </Badge>
                                            )}
                                        </div>
                                        <FormField
                                            control={form.control}
                                            name="name"
                                            render={({ field }) => (
                                                <FormItem>
                                                    <FormLabel>
                                                        {t("name")}
                                                    </FormLabel>
                                                    <FormControl>
                                                        <Input
                                                            {...field}
                                                            placeholder={t(
                                                                "alertingRuleNamePlaceholder"
                                                            )}
                                                        />
                                                    </FormControl>
                                                    <FormMessage />
                                                </FormItem>
                                            )}
                                        />
                                        <FormField
                                            control={form.control}
                                            name="cooldownSeconds"
                                            render={({ field }) => (
                                                <FormItem>
                                                    <FormLabel>
                                                        {t(
                                                            "alertingRuleCooldown"
                                                        )}
                                                    </FormLabel>
                                                    <FormControl>
                                                        <Input
                                                            type="number"
                                                            min={0}
                                                            step={1}
                                                            {...field}
                                                            value={field.value}
                                                            onChange={(e) =>
                                                                field.onChange(
                                                                    Number(
                                                                        e.target
                                                                            .value
                                                                    )
                                                                )
                                                            }
                                                        />
                                                    </FormControl>
                                                    <FormDescription>
                                                        {t(
                                                            "alertingRuleCooldownDescription"
                                                        )}
                                                    </FormDescription>
                                                    <FormMessage />
                                                </FormItem>
                                            )}
                                        />
                                        <FormField
                                            control={form.control}
                                            name="enabled"
                                            render={({ field }) => (
                                                <FormItem>
                                                    <FormControl>
                                                        <SwitchInput
                                                            id="alert-rule-enabled"
                                                            label={t(
                                                                "alertingRuleEnabled"
                                                            )}
                                                            checked={
                                                                field.value
                                                            }
                                                            onCheckedChange={
                                                                field.onChange
                                                            }
                                                            disabled={disabled}
                                                        />
                                                    </FormControl>
                                                    <FormMessage />
                                                </FormItem>
                                            )}
                                        />
                                        <div className="flex flex-col items-center w-full gap-3">
                                            <Button
                                                type="submit"
                                                className="w-full"
                                                disabled={isSaving}
                                                loading={isSaving}
                                            >
                                                {t("save")}
                                            </Button>

                                            <Button
                                                type="button"
                                                variant="outline"
                                                className="w-full gap-1.5"
                                                onClick={() =>
                                                    startTransition(testAlert)
                                                }
                                                loading={isTestingAlert}
                                            >
                                                <ZapIcon className="size-3.5 flex-none" />
                                                {t("alertingTestRule")}
                                            </Button>
                                        </div>
                                    </fieldset>
                                </CardContent>
                            </Card>
                        </aside>

                        <div className="min-w-0 flex-1 w-full max-w-3xl">
                            <ol className="list-none m-0 p-0">
                                <VerticalRuleStep
                                    stepNumber={1}
                                    isLast={false}
                                    title={t("alertingSectionSource")}
                                    accent={{
                                        labelClass: "",
                                        icon: Flag
                                    }}
                                >
                                    <fieldset
                                        disabled={disabled}
                                        className={
                                            disabled
                                                ? "opacity-50 pointer-events-none"
                                                : ""
                                        }
                                    >
                                        <AlertRuleSourceFields
                                            orgId={orgId}
                                            control={form.control}
                                        />
                                    </fieldset>
                                </VerticalRuleStep>
                                <VerticalRuleStep
                                    stepNumber={2}
                                    isLast={false}
                                    title={t("alertingSectionTrigger")}
                                    accent={{
                                        labelClass: "",
                                        icon: Cog
                                    }}
                                >
                                    <fieldset
                                        disabled={disabled}
                                        className={
                                            disabled
                                                ? "opacity-50 pointer-events-none"
                                                : ""
                                        }
                                    >
                                        <AlertRuleTriggerFields
                                            control={form.control}
                                        />
                                    </fieldset>
                                </VerticalRuleStep>
                                <VerticalRuleStep
                                    stepNumber={3}
                                    isLast
                                    title={t("alertingSectionActions")}
                                    accent={{
                                        labelClass: "",
                                        icon: Zap
                                    }}
                                >
                                    <fieldset
                                        disabled={disabled}
                                        className={
                                            disabled
                                                ? "opacity-50 pointer-events-none"
                                                : ""
                                        }
                                    >
                                        <div className="space-y-4">
                                            <AddActionPanel
                                                onAdd={(type) => {
                                                    if (type === "notify") {
                                                        append({
                                                            type: "notify",
                                                            userTags: [],
                                                            roleTags: [],
                                                            emailTags: []
                                                        });
                                                    } else {
                                                        append({
                                                            type: "webhook",
                                                            url: "",
                                                            method: "POST",
                                                            headers: [
                                                                {
                                                                    key: "",
                                                                    value: ""
                                                                }
                                                            ],
                                                            authType: "none",
                                                            bearerToken: "",
                                                            basicCredentials:
                                                                "",
                                                            customHeaderName:
                                                                "",
                                                            customHeaderValue:
                                                                "",
                                                            useBodyTemplate: false,
                                                            bodyTemplate: ""
                                                        });
                                                    }
                                                }}
                                            />
                                            {fields.length > 0 && (
                                                <div
                                                    role="separator"
                                                    aria-hidden
                                                    className="-mx-4 border-t border-border sm:-mx-5 my-6"
                                                />
                                            )}
                                            {fields.map((f, index) => (
                                                <div key={f.id}>
                                                    {index > 0 && (
                                                        <div
                                                            role="separator"
                                                            aria-hidden
                                                            className="-mx-4 border-t border-border sm:-mx-5 my-6"
                                                        />
                                                    )}
                                                    <ActionBlock
                                                        orgId={orgId}
                                                        index={index}
                                                        control={form.control}
                                                        form={form}
                                                        onRemove={() =>
                                                            remove(index)
                                                        }
                                                        onUpdate={(val) =>
                                                            update(index, val)
                                                        }
                                                        canRemove
                                                    />
                                                </div>
                                            ))}
                                        </div>
                                    </fieldset>
                                </VerticalRuleStep>
                            </ol>
                        </div>
                    </div>
                </SettingsContainer>
            </form>
        </Form>
    );
}
