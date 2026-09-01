"use client";

import { Button } from "@app/components/ui/button";
import {
    Form,
    FormControl,
    FormDescription,
    FormField,
    FormItem,
    FormMessage
} from "@app/components/ui/form";
import { Label } from "@app/components/ui/label";
import { toast } from "@app/hooks/useToast";
import { zodResolver } from "@hookform/resolvers/zod";
import { AxiosResponse } from "axios";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import {
    Credenza,
    CredenzaBody,
    CredenzaClose,
    CredenzaContent,
    CredenzaDescription,
    CredenzaFooter,
    CredenzaHeader,
    CredenzaTitle
} from "@app/components/Credenza";
import { useOrgContext } from "@app/hooks/useOrgContext";
import { formatAxiosError, createApiClient } from "@app/lib/api";
import { cn } from "@app/lib/cn";
import { useEnvContext } from "@app/hooks/useEnvContext";
import {
    Popover,
    PopoverContent,
    PopoverTrigger
} from "@app/components/ui/popover";
import { CaretSortIcon } from "@radix-ui/react-icons";
import { Checkbox } from "@app/components/ui/checkbox";
import { useTranslations } from "next-intl";
import { UserSelector, type SelectedUser } from "@app/components/user-selector";
import type { CreateOrEditVirtualApiKeyResponse } from "@server/routers/virtualApiKey/types";
import { formatVirtualApiKeyCredential } from "@app/lib/virtualApiKeyFormat";
import {
    MultiResourcesSelector,
    formatMultiResourcesSelectorLabel
} from "@app/components/multi-resource-selector";
import type { SelectedResource } from "@app/components/resource-selector";
import { getUserDisplayName } from "@app/lib/getUserDisplayName";
import CopyTextBox from "@app/components/CopyTextBox";
import type { CreatedVirtualApiKey } from "@app/components/CreateVirtualApiKeyForm";
import type { GetVirtualApiKeyResponse } from "@server/routers/virtualApiKey/types";
import { HorizontalTabs } from "@app/components/HorizontalTabs";
import {
    BudgetRowsFields,
    getBudgetRowsErrors,
    rowsFromBudgets,
    saveBudgetRows,
    type BudgetRow
} from "@app/components/BudgetsEditor";
import { aiBudgetQueries } from "@app/lib/queries";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import VirtualApiKeyEmailSection from "@app/components/VirtualApiKeyEmailSection";
import type { Tag } from "@app/components/tags/tag-input";

type FormProps = {
    open: boolean;
    setOpen: (open: boolean) => void;
    virtualApiKey: CreatedVirtualApiKey | null;
    onUpdated?: (result: CreatedVirtualApiKey) => void;
};

function resourcesFromRow(key: CreatedVirtualApiKey): SelectedResource[] {
    return key.resources.map((r) => ({
        resourceId: r.resourceId,
        name: r.name,
        niceId: r.niceId,
        fullDomain: null,
        ssl: false,
        wildcard: false
    }));
}

function userFromRow(key: CreatedVirtualApiKey): SelectedUser | null {
    if (!key.userId) {
        return null;
    }
    return {
        id: key.userId,
        text: getUserDisplayName({
            email: key.userEmail,
            name: key.userName,
            username: key.username
        })
    };
}

export default function EditVirtualApiKeyForm({
    open,
    setOpen,
    virtualApiKey,
    onUpdated
}: FormProps) {
    const { org } = useOrgContext();
    const { env } = useEnvContext();
    const api = createApiClient({ env });
    const t = useTranslations();
    const queryClient = useQueryClient();

    const [loading, setLoading] = useState(false);
    const [selectedUser, setSelectedUser] = useState<SelectedUser | null>(null);
    const [selectedResources, setSelectedResources] = useState<
        SelectedResource[]
    >([]);
    const [credential, setCredential] = useState<string | null>(null);
    const [credentialLoading, setCredentialLoading] = useState(false);
    const [pendingBudgetRows, setPendingBudgetRows] = useState<BudgetRow[]>([]);
    const [attemptedBudgetsSave, setAttemptedBudgetsSave] = useState(false);
    const [sendEmail, setSendEmail] = useState(false);
    const [sendToAttributedUser, setSendToAttributedUser] = useState(false);
    const [emailTags, setEmailTags] = useState<Tag[]>([]);

    const budgetScope = {
        type: "virtualApiKey" as const,
        id: virtualApiKey?.virtualApiKeyId ?? ""
    };
    const budgetsQuery = useQuery({
        ...aiBudgetQueries.scoped({ scope: budgetScope }),
        enabled: open && !!virtualApiKey
    });

    const formSchema = z
        .object({
            allResources: z.boolean()
        })
        .superRefine((data, ctx) => {
            if (!data.allResources && selectedResources.length === 0) {
                ctx.addIssue({
                    code: z.ZodIssueCode.custom,
                    message: t("virtualApiKeysSelectResourcesRequired"),
                    path: ["allResources"]
                });
            }
        });

    const form = useForm<z.infer<typeof formSchema>>({
        resolver: zodResolver(formSchema),
        defaultValues: {
            allResources: false
        }
    });

    const allResources = form.watch("allResources");

    useEffect(() => {
        if (!open || !virtualApiKey) {
            return;
        }
        setLoading(false);
        setSelectedUser(userFromRow(virtualApiKey));
        setSelectedResources(
            virtualApiKey.allResources ? [] : resourcesFromRow(virtualApiKey)
        );
        setSendEmail(false);
        setSendToAttributedUser(false);
        setEmailTags([]);
        form.reset({
            allResources: virtualApiKey.allResources
        });

        let cancelled = false;
        setCredentialLoading(true);
        setCredential(null);

        api.get<AxiosResponse<GetVirtualApiKeyResponse>>(
            `/virtual-api-key/${virtualApiKey.virtualApiKeyId}`
        )
            .then((res) => {
                if (cancelled) {
                    return;
                }
                const secret = res.data.data.virtualApiKey.secret;
                if (secret) {
                    setCredential(
                        formatVirtualApiKeyCredential(
                            virtualApiKey.virtualApiKeyId,
                            secret
                        )
                    );
                } else {
                    toast({
                        variant: "destructive",
                        title: t("virtualApiKeysErrorFetchSecret"),
                        description: t(
                            "virtualApiKeysErrorFetchSecretDescription"
                        )
                    });
                }
            })
            .catch((e) => {
                if (cancelled) {
                    return;
                }
                toast({
                    variant: "destructive",
                    title: t("virtualApiKeysErrorFetchSecret"),
                    description: formatAxiosError(
                        e,
                        t("virtualApiKeysErrorFetchSecretDescription")
                    )
                });
            })
            .finally(() => {
                if (!cancelled) {
                    setCredentialLoading(false);
                }
            });

        return () => {
            cancelled = true;
        };
    }, [open, virtualApiKey, form]);

    useEffect(() => {
        if (!open || !budgetsQuery.data) {
            return;
        }
        setPendingBudgetRows(rowsFromBudgets(budgetsQuery.data));
        setAttemptedBudgetsSave(false);
    }, [open, budgetsQuery.data]);

    function handleFormSubmit(values: z.infer<typeof formSchema>) {
        const { conflictingKeys, invalidAmountKeys } =
            getBudgetRowsErrors(pendingBudgetRows);
        if (conflictingKeys.size > 0 || invalidAmountKeys.size > 0) {
            setAttemptedBudgetsSave(true);
            toast({
                variant: "destructive",
                title: t("aiBudgetErrorSave"),
                description: conflictingKeys.size
                    ? t("aiBudgetConflictError")
                    : t("aiBudgetInvalidAmountError")
            });
            return;
        }

        if (
            env.email.emailEnabled &&
            sendEmail &&
            !sendToAttributedUser &&
            emailTags.length === 0
        ) {
            toast({
                variant: "destructive",
                title: t("virtualApiKeysEmailRecipientsRequired"),
                description: t("virtualApiKeysEmailRecipientsRequired")
            });
            return;
        }

        return onSubmit(values);
    }

    async function onSubmit(values: z.infer<typeof formSchema>) {
        if (!virtualApiKey) {
            return;
        }

        setLoading(true);

        const res = await api
            .post<AxiosResponse<CreateOrEditVirtualApiKeyResponse>>(
                `/virtual-api-key/${virtualApiKey.virtualApiKeyId}`,
                {
                    userId: selectedUser?.id ?? null,
                    allResources: values.allResources,
                    resourceIds: values.allResources
                        ? []
                        : selectedResources.map((r) => r.resourceId),
                    sendEmail: env.email.emailEnabled && sendEmail,
                    sendToAttributedUser:
                        env.email.emailEnabled &&
                        sendEmail &&
                        sendToAttributedUser,
                    emails:
                        env.email.emailEnabled && sendEmail
                            ? emailTags.map((tag) => tag.text)
                            : []
                }
            )
            .catch((e) => {
                console.error(e);
                toast({
                    variant: "destructive",
                    title: t("virtualApiKeysErrorUpdate"),
                    description: formatAxiosError(
                        e,
                        t("virtualApiKeysErrorUpdateDescription")
                    )
                });
            });

        if (res?.data.data.virtualApiKey) {
            const key = res.data.data.virtualApiKey;

            try {
                await saveBudgetRows({
                    api,
                    orgId: virtualApiKey.orgId,
                    scope: budgetScope,
                    existingBudgets: budgetsQuery.data ?? [],
                    rows: pendingBudgetRows
                });
                await queryClient.invalidateQueries(
                    aiBudgetQueries.scoped({ scope: budgetScope })
                );
            } catch (e) {
                toast({
                    variant: "destructive",
                    title: t("aiBudgetErrorSave"),
                    description: formatAxiosError(e, t("aiBudgetErrorSave"))
                });
            }

            const resourceLookup = new Map(
                selectedResources.map((r) => [
                    r.resourceId,
                    { name: r.name, niceId: r.niceId }
                ])
            );
            const resourceNames = key.allResources
                ? t("virtualApiKeysAllResources")
                : key.resourceIds
                      .map((id) => resourceLookup.get(id)?.name)
                      .filter(Boolean)
                      .join(", ") || t("virtualApiKeysNoResources");

            onUpdated?.({
                ...virtualApiKey,
                userId: key.userId,
                allResources: key.allResources,
                resourceIds: key.resourceIds,
                userName: selectedUser?.text ?? null,
                username: null,
                userEmail: null,
                resourceNames,
                resources: key.resourceIds.map((id) => ({
                    resourceId: id,
                    name: resourceLookup.get(id)?.name ?? String(id),
                    niceId: resourceLookup.get(id)?.niceId ?? ""
                }))
            });

            toast({
                title: t("virtualApiKeysUpdated"),
                description: t("virtualApiKeysUpdatedDescription")
            });
            setOpen(false);
        }

        setLoading(false);
    }

    return (
        <Credenza
            open={open}
            onOpenChange={(val) => {
                setOpen(val);
            }}
        >
            <CredenzaContent>
                <CredenzaHeader>
                    <CredenzaTitle>{t("virtualApiKeysEdit")}</CredenzaTitle>
                    <CredenzaDescription>
                        {t("virtualApiKeysEditDescription")}
                    </CredenzaDescription>
                </CredenzaHeader>
                <CredenzaBody>
                    <div className="flex flex-col gap-y-4 px-1">
                        <Form {...form}>
                            <form
                                onSubmit={form.handleSubmit(handleFormSubmit)}
                                className="space-y-4"
                                id="edit-virtual-api-key-form"
                            >
                                <HorizontalTabs
                                    clientSide={true}
                                    defaultTab={0}
                                    items={[
                                        { title: t("general"), href: "#" },
                                        {
                                            title: t(
                                                "virtualApiKeysInferenceBudget"
                                            ),
                                            href: "#"
                                        }
                                    ]}
                                >
                                    <div className="space-y-4 mt-4">
                                        <div className="space-y-2">
                                            <Label>
                                                {t(
                                                    "virtualApiKeysAssociateUserOptional"
                                                )}
                                            </Label>
                                            <Popover>
                                                <PopoverTrigger asChild>
                                                    <Button
                                                        variant="outline"
                                                        role="combobox"
                                                        className={cn(
                                                            "w-full justify-between",
                                                            !selectedUser &&
                                                                "text-muted-foreground"
                                                        )}
                                                    >
                                                        {selectedUser?.text
                                                            ? selectedUser.text
                                                            : t("userSelect")}
                                                        <CaretSortIcon className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                                                    </Button>
                                                </PopoverTrigger>
                                                <PopoverContent className="p-0 w-[var(--radix-popover-trigger-width)]">
                                                    <UserSelector
                                                        orgId={org.org.orgId}
                                                        selectedUser={
                                                            selectedUser
                                                        }
                                                        onSelectUser={
                                                            setSelectedUser
                                                        }
                                                    />
                                                </PopoverContent>
                                            </Popover>
                                            <p className="text-sm text-muted-foreground">
                                                {t(
                                                    "virtualApiKeysAssociateUserDescription"
                                                )}
                                            </p>
                                        </div>

                                        <div className="space-y-3">
                                            <FormField
                                                control={form.control}
                                                name="allResources"
                                                render={({ field }) => (
                                                    <FormItem>
                                                        <div className="flex items-start space-x-2">
                                                            <FormControl>
                                                                <Checkbox
                                                                    id="edit-all-resources"
                                                                    checked={
                                                                        field.value
                                                                    }
                                                                    onCheckedChange={(
                                                                        val
                                                                    ) => {
                                                                        field.onChange(
                                                                            val as boolean
                                                                        );
                                                                        if (
                                                                            val
                                                                        ) {
                                                                            setSelectedResources(
                                                                                []
                                                                            );
                                                                        }
                                                                    }}
                                                                    className="mt-0.5"
                                                                />
                                                            </FormControl>
                                                            <div className="space-y-1">
                                                                <label
                                                                    htmlFor="edit-all-resources"
                                                                    className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
                                                                >
                                                                    {t(
                                                                        "virtualApiKeysAllResources"
                                                                    )}
                                                                </label>
                                                                <p className="text-sm text-muted-foreground">
                                                                    {t(
                                                                        "virtualApiKeysAllResourcesDescription"
                                                                    )}
                                                                </p>
                                                            </div>
                                                        </div>
                                                        <FormMessage />
                                                    </FormItem>
                                                )}
                                            />

                                            {!allResources && (
                                                <div className="space-y-2">
                                                    <Label>
                                                        {t(
                                                            "virtualApiKeysSelectResources"
                                                        )}
                                                    </Label>
                                                    <Popover>
                                                        <PopoverTrigger asChild>
                                                            <Button
                                                                variant="outline"
                                                                role="combobox"
                                                                className={cn(
                                                                    "w-full justify-between",
                                                                    selectedResources.length ===
                                                                        0 &&
                                                                        "text-muted-foreground"
                                                                )}
                                                            >
                                                                <span className="truncate text-left">
                                                                    {formatMultiResourcesSelectorLabel(
                                                                        selectedResources,
                                                                        t,
                                                                        "virtualApiKeysSelectResourcesPlaceholder"
                                                                    )}
                                                                </span>
                                                                <CaretSortIcon className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                                                            </Button>
                                                        </PopoverTrigger>
                                                        <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0">
                                                            <MultiResourcesSelector
                                                                orgId={
                                                                    org.org
                                                                        .orgId
                                                                }
                                                                selectedResources={
                                                                    selectedResources
                                                                }
                                                                onSelectionChange={
                                                                    setSelectedResources
                                                                }
                                                                protocol="inference"
                                                                showClear={
                                                                    selectedResources.length >
                                                                    0
                                                                }
                                                                onClear={() =>
                                                                    setSelectedResources(
                                                                        []
                                                                    )
                                                                }
                                                            />
                                                        </PopoverContent>
                                                    </Popover>
                                                    <FormDescription>
                                                        {t(
                                                            "virtualApiKeysSelectResourcesRequired"
                                                        )}
                                                    </FormDescription>
                                                </div>
                                            )}
                                        </div>

                                        <VirtualApiKeyEmailSection
                                            emailEnabled={
                                                env.email.emailEnabled
                                            }
                                            mode="edit"
                                            sendEmail={sendEmail}
                                            onSendEmailChange={setSendEmail}
                                            sendToAttributedUser={
                                                sendToAttributedUser
                                            }
                                            onSendToAttributedUserChange={
                                                setSendToAttributedUser
                                            }
                                            hasAssociatedUser={!!selectedUser}
                                            emailTags={emailTags}
                                            onEmailTagsChange={setEmailTags}
                                        />
                                    </div>

                                    <div className="space-y-4 mt-4">
                                        <BudgetRowsFields
                                            rows={pendingBudgetRows}
                                            onChange={setPendingBudgetRows}
                                            disabled={budgetsQuery.isLoading}
                                            attemptedSave={attemptedBudgetsSave}
                                        />
                                    </div>
                                </HorizontalTabs>
                            </form>
                        </Form>
                    </div>
                </CredenzaBody>
                <CredenzaFooter>
                    <CredenzaClose asChild>
                        <Button variant="outline">{t("close")}</Button>
                    </CredenzaClose>
                    <Button
                        type="submit"
                        form="edit-virtual-api-key-form"
                        loading={loading}
                        disabled={loading || !virtualApiKey}
                    >
                        {t("virtualApiKeysSaveButton")}
                    </Button>
                </CredenzaFooter>
            </CredenzaContent>
        </Credenza>
    );
}
