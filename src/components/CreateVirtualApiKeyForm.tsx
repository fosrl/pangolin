"use client";

import { Button } from "@app/components/ui/button";
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
import { toast } from "@app/hooks/useToast";
import { zodResolver } from "@hookform/resolvers/zod";
import { AxiosResponse } from "axios";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import CopyTextBox from "@app/components/CopyTextBox";
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
import { HorizontalTabs } from "@app/components/HorizontalTabs";
import {
    BudgetRowsFields,
    getBudgetRowsErrors,
    type BudgetRow
} from "@app/components/BudgetsEditor";
import VirtualApiKeyEmailSection from "@app/components/VirtualApiKeyEmailSection";
import type { Tag } from "@app/components/tags/tag-input";

export type CreatedVirtualApiKey = {
    virtualApiKeyId: string;
    orgId: string;
    kind: "manual" | "user";
    userId: string | null;
    name: string | null;
    description: string | null;
    lastChars: string;
    allResources: boolean;
    expiresAt: number | null;
    lastUsedAt: number | null;
    createdAt: number;
    createdByUserId: string | null;
    resourceIds: number[];
    userName?: string | null;
    username?: string | null;
    userEmail?: string | null;
    resourceNames: string;
    resources: { resourceId: number; name: string; niceId: string }[];
};

type FormProps = {
    open: boolean;
    setOpen: (open: boolean) => void;
    onCreated?: (result: CreatedVirtualApiKey) => void;
};

export default function CreateVirtualApiKeyForm({
    open,
    setOpen,
    onCreated
}: FormProps) {
    const { org } = useOrgContext();
    const { env } = useEnvContext();
    const api = createApiClient({ env });
    const t = useTranslations();

    const [credential, setCredential] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);
    const [allResources, setAllResources] = useState(false);
    const [selectedUser, setSelectedUser] = useState<SelectedUser | null>(null);
    const [selectedResources, setSelectedResources] = useState<
        SelectedResource[]
    >([]);
    const [pendingBudgetRows, setPendingBudgetRows] = useState<BudgetRow[]>([]);
    const [attemptedBudgetsSave, setAttemptedBudgetsSave] = useState(false);
    const [sendEmail, setSendEmail] = useState(false);
    const [sendToAttributedUser, setSendToAttributedUser] = useState(false);
    const [emailTags, setEmailTags] = useState<Tag[]>([]);

    const formSchema = z.object({
        name: z.string().min(1),
        description: z.string().optional()
    });

    const form = useForm<z.infer<typeof formSchema>>({
        resolver: zodResolver(formSchema),
        defaultValues: {
            name: "",
            description: ""
        }
    });

    function resetLocalState() {
        setCredential(null);
        setLoading(false);
        setAllResources(false);
        setSelectedUser(null);
        setSelectedResources([]);
        setPendingBudgetRows([]);
        setAttemptedBudgetsSave(false);
        setSendEmail(false);
        setSendToAttributedUser(false);
        setEmailTags([]);
        form.reset();
    }

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
        setLoading(true);

        const res = await api
            .put<AxiosResponse<CreateOrEditVirtualApiKeyResponse>>(
                `/org/${org.org.orgId}/virtual-api-key`,
                {
                    name: values.name,
                    description: values.description || null,
                    userId: selectedUser?.id ?? null,
                    allResources,
                    resourceIds: allResources
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
                    title: t("virtualApiKeysErrorCreate"),
                    description: formatAxiosError(
                        e,
                        t("virtualApiKeysErrorCreateDescription")
                    )
                });
            });

        if (res?.data.data.virtualApiKey) {
            const key = res.data.data.virtualApiKey;
            if (key.secret) {
                setCredential(
                    formatVirtualApiKeyCredential(
                        key.virtualApiKeyId,
                        key.secret
                    )
                );
            }

            const pendingBudgets = pendingBudgetRows.filter(
                (budget) => budget.amount.trim() !== ""
            );
            if (pendingBudgets.length > 0) {
                try {
                    await Promise.all(
                        pendingBudgets.map((budget) =>
                            api.put(`/org/${org.org.orgId}/ai-budget`, {
                                virtualApiKeyId: key.virtualApiKeyId,
                                amount: Number(budget.amount),
                                unit: budget.unit,
                                period: budget.period
                            })
                        )
                    );
                } catch (e) {
                    toast({
                        variant: "destructive",
                        title: t("aiBudgetErrorSave"),
                        description: formatAxiosError(e, t("aiBudgetErrorSave"))
                    });
                }
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

            onCreated?.({
                virtualApiKeyId: key.virtualApiKeyId,
                orgId: key.orgId,
                kind: key.kind,
                userId: key.userId,
                name: key.name,
                description: key.description,
                lastChars: key.lastChars,
                allResources: key.allResources,
                expiresAt: key.expiresAt,
                lastUsedAt: key.lastUsedAt,
                createdAt: key.createdAt,
                createdByUserId: key.createdByUserId,
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
        }

        setLoading(false);
    }

    return (
        <Credenza
            open={open}
            onOpenChange={(val) => {
                setOpen(val);
                if (!val) {
                    resetLocalState();
                }
            }}
        >
            <CredenzaContent>
                <CredenzaHeader>
                    <CredenzaTitle>{t("virtualApiKeysCreate")}</CredenzaTitle>
                    <CredenzaDescription>
                        {t("virtualApiKeysCreateDescription")}
                    </CredenzaDescription>
                </CredenzaHeader>
                <CredenzaBody>
                    <div className="flex flex-col gap-y-4 px-1">
                        {!credential && (
                            <Form {...form}>
                                <form
                                    onSubmit={form.handleSubmit(
                                        handleFormSubmit
                                    )}
                                    className="space-y-4"
                                    id="virtual-api-key-form"
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
                                            <FormField
                                                control={form.control}
                                                name="name"
                                                render={({ field }) => (
                                                    <FormItem>
                                                        <FormLabel>
                                                            {t(
                                                                "virtualApiKeysName"
                                                            )}
                                                        </FormLabel>
                                                        <FormControl>
                                                            <Input {...field} />
                                                        </FormControl>
                                                        <FormMessage />
                                                    </FormItem>
                                                )}
                                            />

                                            <FormField
                                                control={form.control}
                                                name="description"
                                                render={({ field }) => (
                                                    <FormItem>
                                                        <FormLabel>
                                                            {t(
                                                                "virtualApiKeysDescriptionOptional"
                                                            )}
                                                        </FormLabel>
                                                        <FormControl>
                                                            <Input {...field} />
                                                        </FormControl>
                                                        <FormMessage />
                                                    </FormItem>
                                                )}
                                            />

                                            <div className="space-y-2">
                                                <FormLabel>
                                                    {t(
                                                        "virtualApiKeysAssociateUserOptional"
                                                    )}
                                                </FormLabel>
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
                                                                : t(
                                                                      "userSelect"
                                                                  )}
                                                            <CaretSortIcon className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                                                        </Button>
                                                    </PopoverTrigger>
                                                    <PopoverContent className="p-0 w-[var(--radix-popover-trigger-width)]">
                                                        <UserSelector
                                                            orgId={
                                                                org.org.orgId
                                                            }
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
                                                <div className="flex items-start space-x-2">
                                                    <Checkbox
                                                        id="all-resources"
                                                        checked={allResources}
                                                        onCheckedChange={(
                                                            val
                                                        ) => {
                                                            setAllResources(
                                                                val as boolean
                                                            );
                                                            if (val) {
                                                                setSelectedResources(
                                                                    []
                                                                );
                                                            }
                                                        }}
                                                        className="mt-0.5"
                                                    />
                                                    <div className="space-y-1">
                                                        <label
                                                            htmlFor="all-resources"
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

                                                {!allResources && (
                                                    <div className="space-y-2">
                                                        <FormLabel>
                                                            {t(
                                                                "virtualApiKeysSelectResources"
                                                            )}
                                                        </FormLabel>
                                                        <Popover>
                                                            <PopoverTrigger
                                                                asChild
                                                            >
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
                                                                "virtualApiKeysSelectResourcesDescription"
                                                            )}
                                                        </FormDescription>
                                                    </div>
                                                )}
                                            </div>

                                            <VirtualApiKeyEmailSection
                                                emailEnabled={
                                                    env.email.emailEnabled
                                                }
                                                mode="create"
                                                sendEmail={sendEmail}
                                                onSendEmailChange={setSendEmail}
                                                sendToAttributedUser={
                                                    sendToAttributedUser
                                                }
                                                onSendToAttributedUserChange={
                                                    setSendToAttributedUser
                                                }
                                                hasAssociatedUser={
                                                    !!selectedUser
                                                }
                                                emailTags={emailTags}
                                                onEmailTagsChange={setEmailTags}
                                            />
                                        </div>

                                        <div className="space-y-4 mt-4">
                                            <BudgetRowsFields
                                                rows={pendingBudgetRows}
                                                onChange={setPendingBudgetRows}
                                                attemptedSave={
                                                    attemptedBudgetsSave
                                                }
                                            />
                                        </div>
                                    </HorizontalTabs>
                                </form>
                            </Form>
                        )}
                        {credential && (
                            <div className="space-y-4">
                                <p>{t("virtualApiKeysCopyKey")}</p>
                                <CopyTextBox
                                    text={credential}
                                    wrapText={false}
                                />
                            </div>
                        )}
                    </div>
                </CredenzaBody>
                <CredenzaFooter>
                    <CredenzaClose asChild>
                        <Button variant="outline">{t("close")}</Button>
                    </CredenzaClose>
                    <Button
                        type="button"
                        onClick={form.handleSubmit(handleFormSubmit)}
                        loading={loading}
                        disabled={credential !== null || loading}
                    >
                        {t("virtualApiKeysCreateButton")}
                    </Button>
                </CredenzaFooter>
            </CredenzaContent>
        </Credenza>
    );
}
