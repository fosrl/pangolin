"use client";

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
import { Textarea } from "@app/components/ui/textarea";
import {
    OptionSelect,
    type OptionSelectOption
} from "@app/components/OptionSelect";
import { TextFileImportDialog } from "@app/components/TextFileImportDialog";
import { useEnvContext } from "@app/hooks/useEnvContext";
import { usePaidStatus } from "@app/hooks/usePaidStatus";
import { toast } from "@app/hooks/useToast";
import { cn } from "@app/lib/cn";
import {
    getTextImportFileType,
    isSupportedTextImportFile,
    parseTextFileItems,
    readFileAsText,
    type TextImportFileType
} from "@app/lib/roleFormTextImport";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { HorizontalTabs } from "@app/components/HorizontalTabs";
import { PaidFeaturesAlert } from "./PaidFeaturesAlert";
import { CheckboxWithLabel } from "./ui/checkbox";
import { tierMatrix } from "@server/lib/billing/tierMatrix";
import type { Role } from "@server/db";

export const SSH_SUDO_MODE_VALUES = ["none", "full", "commands"] as const;
export type SshSudoMode = (typeof SSH_SUDO_MODE_VALUES)[number];

function parseRoleJsonArray(value: string | null | undefined): string[] {
    if (value == null || value === "") return [];
    try {
        const parsed = JSON.parse(value);
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
}

function toSshSudoMode(value: string | null | undefined): SshSudoMode {
    if (value === "none" || value === "full" || value === "commands")
        return value;
    return "none";
}

export function parseUnixGroups(value: string | undefined): string[] {
    if (!value?.trim()) return [];

    return value
        .split(/\r?\n/)
        .map((group) => group.trim())
        .filter(Boolean);
}

export function parseSudoCommands(value: string | undefined): string[] {
    if (!value?.trim()) return [];

    return value
        .split(/\r?\n/)
        .map((command) => command.trim())
        .filter(Boolean);
}

function hasOnlyAbsoluteSudoCommands(value: string | undefined): boolean {
    return parseSudoCommands(value).every((command) => {
        const executable = command.split(/\s+/)[0];
        return executable.startsWith("/");
    });
}

export type RoleFormValues = {
    name: string;
    description?: string;
    requireDeviceApproval?: boolean;
    allowSsh?: boolean;
    sshSudoMode: SshSudoMode;
    sshSudoCommands?: string;
    sshCreateHomeDir?: boolean;
    sshUnixGroups?: string;
};

type RoleFormProps = {
    variant: "create" | "edit";
    role?: Role;
    onSubmit: (values: RoleFormValues) => void | Promise<void>;
    formId?: string;
};

type RoleTextImportField = "sshSudoCommands" | "sshUnixGroups";

type PendingTextImport = {
    field: RoleTextImportField;
    fileName: string;
    fileType: TextImportFileType;
    rawContent: string;
};

export function RoleForm({
    variant,
    role,
    onSubmit,
    formId = "create-role-form"
}: RoleFormProps) {
    const t = useTranslations();
    const { isPaidUser } = usePaidStatus();
    const { env } = useEnvContext();

    const formSchema = z
        .object({
            name: z
                .string({ message: t("nameRequired") })
                .min(1)
                .max(32),
            description: z.string().max(255).optional(),
            requireDeviceApproval: z.boolean().optional(),
            allowSsh: z.boolean().optional(),
            sshSudoMode: z.enum(SSH_SUDO_MODE_VALUES),
            sshSudoCommands: z.string().optional(),
            sshCreateHomeDir: z.boolean().optional(),
            sshUnixGroups: z.string().optional()
        })
        .superRefine((values, ctx) => {
            if (
                values.sshSudoMode === "commands" &&
                !hasOnlyAbsoluteSudoCommands(values.sshSudoCommands)
            ) {
                ctx.addIssue({
                    code: z.ZodIssueCode.custom,
                    path: ["sshSudoCommands"],
                    message:
                        "Each sudo command must start with an absolute path (for example, /usr/bin/systemctl)."
                });
            }
        });

    const defaultValues: RoleFormValues = role
        ? {
              name: role.name,
              description: role.description ?? "",
              requireDeviceApproval: role.requireDeviceApproval ?? false,
              allowSsh:
                  (role as Role & { allowSsh?: boolean }).allowSsh ?? false,
              sshSudoMode: toSshSudoMode(role.sshSudoMode),
              sshSudoCommands: parseRoleJsonArray(role.sshSudoCommands).join(
                  "\n"
              ),
              sshCreateHomeDir: role.sshCreateHomeDir ?? false,
              sshUnixGroups: parseRoleJsonArray(role.sshUnixGroups).join("\n")
          }
        : {
              name: "",
              description: "",
              requireDeviceApproval: false,
              allowSsh: false,
              sshSudoMode: "none",
              sshSudoCommands: "",
              sshCreateHomeDir: true,
              sshUnixGroups: ""
          };

    const form = useForm<z.infer<typeof formSchema>>({
        resolver: zodResolver(formSchema),
        defaultValues
    });

    useEffect(() => {
        if (variant === "edit" && role) {
            form.reset({
                name: role.name,
                description: role.description ?? "",
                requireDeviceApproval: role.requireDeviceApproval ?? false,
                allowSsh:
                    (role as Role & { allowSsh?: boolean }).allowSsh ?? false,
                sshSudoMode: toSshSudoMode(role.sshSudoMode),
                sshSudoCommands: parseRoleJsonArray(role.sshSudoCommands).join(
                    "\n"
                ),
                sshCreateHomeDir: role.sshCreateHomeDir ?? false,
                sshUnixGroups: parseRoleJsonArray(role.sshUnixGroups).join("\n")
            });
        }
    }, [variant, role, form]);

    const sshDisabled = !isPaidUser(tierMatrix.advancedPrivateResources);
    const sshSudoMode = form.watch("sshSudoMode");
    const isAdminRole = variant === "edit" && role?.isAdmin === true;
    const [pendingImport, setPendingImport] =
        useState<PendingTextImport | null>(null);
    const [dragOverField, setDragOverField] =
        useState<RoleTextImportField | null>(null);

    useEffect(() => {
        if (sshDisabled) {
            form.setValue("allowSsh", false);
        }
    }, [sshDisabled, form]);

    async function handleFileDrop(
        file: File,
        field: RoleTextImportField
    ): Promise<void> {
        if (!isSupportedTextImportFile(file)) {
            toast({
                variant: "destructive",
                title: t("roleTextImportInvalidFile"),
                description: t("roleTextImportInvalidFileDescription")
            });
            return;
        }

        const fileType = getTextImportFileType(file);
        if (!fileType) return;

        const rawContent = await readFileAsText(file);
        const parser =
            field === "sshSudoCommands" ? parseSudoCommands : parseUnixGroups;
        const items = parseTextFileItems({
            content: rawContent,
            fileType,
            skipHeader: false,
            parser
        });

        if (items.length === 0) {
            toast({
                variant: "destructive",
                title: t("roleTextImportEmpty"),
                description: t("roleTextImportEmptyDescription")
            });
            return;
        }

        setPendingImport({
            field,
            fileName: file.name,
            fileType,
            rawContent
        });
    }

    function getTextImportDropHandlers(field: RoleTextImportField) {
        return {
            onDragOver: (event: React.DragEvent<HTMLTextAreaElement>) => {
                event.preventDefault();
                event.stopPropagation();
                if (!sshDisabled) {
                    setDragOverField(field);
                }
            },
            onDragLeave: (event: React.DragEvent<HTMLTextAreaElement>) => {
                event.preventDefault();
                setDragOverField((current) =>
                    current === field ? null : current
                );
            },
            onDrop: (event: React.DragEvent<HTMLTextAreaElement>) => {
                event.preventDefault();
                event.stopPropagation();
                setDragOverField(null);
                if (sshDisabled) return;

                const file = event.dataTransfer.files[0];
                if (file) {
                    void handleFileDrop(file, field);
                }
            }
        };
    }

    return (
        <Form {...form}>
            <form
                onSubmit={form.handleSubmit((values) => onSubmit(values))}
                className="space-y-4"
                id={formId}
            >
                {env.flags.disableEnterpriseFeatures ? (
                    <div className="space-y-4 mt-4">
                        <FormField
                            control={form.control}
                            name="name"
                            render={({ field }) => (
                                <FormItem>
                                    <FormLabel>{t("accessRoleName")}</FormLabel>
                                    <FormControl>
                                        <Input
                                            {...field}
                                            disabled={isAdminRole}
                                            readOnly={isAdminRole}
                                        />
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
                                    <FormLabel>{t("description")}</FormLabel>
                                    <FormControl>
                                        <Input
                                            {...field}
                                            disabled={isAdminRole}
                                            readOnly={isAdminRole}
                                        />
                                    </FormControl>
                                    <FormMessage />
                                </FormItem>
                            )}
                        />
                    </div>
                ) : (
                    <HorizontalTabs
                        clientSide={true}
                        defaultTab={0}
                        items={[
                            { title: t("general"), href: "#" },
                            ...(env.flags.disableEnterpriseFeatures
                                ? []
                                : [{ title: t("sshAccess"), href: "#" }])
                        ]}
                    >
                        {/* General tab */}
                        <div className="space-y-4 mt-4">
                            <FormField
                                control={form.control}
                                name="name"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormLabel>
                                            {t("accessRoleName")}
                                        </FormLabel>
                                        <FormControl>
                                            <Input
                                                {...field}
                                                disabled={isAdminRole}
                                                readOnly={isAdminRole}
                                            />
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
                                            {t("description")}
                                        </FormLabel>
                                        <FormControl>
                                            <Input
                                                {...field}
                                                disabled={isAdminRole}
                                                readOnly={isAdminRole}
                                            />
                                        </FormControl>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />
                            <PaidFeaturesAlert
                                tiers={tierMatrix.deviceApprovals}
                            />
                            <FormField
                                control={form.control}
                                name="requireDeviceApproval"
                                render={({ field }) => (
                                    <FormItem className="my-2">
                                        <FormControl>
                                            <CheckboxWithLabel
                                                {...field}
                                                disabled={
                                                    !isPaidUser(
                                                        tierMatrix.deviceApprovals
                                                    )
                                                }
                                                value="on"
                                                checked={form.watch(
                                                    "requireDeviceApproval"
                                                )}
                                                onCheckedChange={(checked) => {
                                                    if (
                                                        checked !==
                                                        "indeterminate"
                                                    ) {
                                                        form.setValue(
                                                            "requireDeviceApproval",
                                                            checked
                                                        );
                                                    }
                                                }}
                                                label={t(
                                                    "requireDeviceApproval"
                                                )}
                                            />
                                        </FormControl>
                                        <FormDescription>
                                            {t(
                                                "requireDeviceApprovalDescription"
                                            )}
                                        </FormDescription>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />
                        </div>

                        {/* SSH tab - hidden when enterprise features are disabled */}
                        {!env.flags.disableEnterpriseFeatures && (
                            <div className="space-y-4 mt-4">
                                <PaidFeaturesAlert
                                    tiers={tierMatrix.advancedPrivateResources}
                                />
                                <FormField
                                    control={form.control}
                                    name="allowSsh"
                                    render={({ field }) => {
                                        const allowSshOptions: OptionSelectOption<
                                            "allow" | "disallow"
                                        >[] = [
                                            {
                                                value: "allow",
                                                label: t("roleAllowSshAllow")
                                            },
                                            {
                                                value: "disallow",
                                                label: t("roleAllowSshDisallow")
                                            }
                                        ];
                                        return (
                                            <FormItem>
                                                <FormLabel>
                                                    {t("roleAllowSsh")}
                                                </FormLabel>
                                                <OptionSelect<
                                                    "allow" | "disallow"
                                                >
                                                    options={allowSshOptions}
                                                    value={
                                                        sshDisabled
                                                            ? "disallow"
                                                            : field.value
                                                              ? "allow"
                                                              : "disallow"
                                                    }
                                                    onChange={(v) => {
                                                        if (sshDisabled) return;
                                                        field.onChange(
                                                            v === "allow"
                                                        );
                                                    }}
                                                    cols={2}
                                                    disabled={sshDisabled}
                                                />
                                                <FormDescription>
                                                    {t(
                                                        "roleAllowSshDescription"
                                                    )}
                                                </FormDescription>
                                                <FormMessage />
                                            </FormItem>
                                        );
                                    }}
                                />
                                <FormField
                                    control={form.control}
                                    name="sshSudoMode"
                                    render={({ field }) => {
                                        const sudoOptions: OptionSelectOption<SshSudoMode>[] =
                                            [
                                                {
                                                    value: "none",
                                                    label: t("sshSudoModeNone")
                                                },
                                                {
                                                    value: "full",
                                                    label: t("sshSudoModeFull")
                                                },
                                                {
                                                    value: "commands",
                                                    label: t(
                                                        "sshSudoModeCommands"
                                                    )
                                                }
                                            ];
                                        return (
                                            <FormItem>
                                                <FormLabel>
                                                    {t("sshSudoMode")}
                                                </FormLabel>
                                                <OptionSelect<SshSudoMode>
                                                    options={sudoOptions}
                                                    value={field.value}
                                                    onChange={field.onChange}
                                                    cols={3}
                                                    disabled={sshDisabled}
                                                />
                                                <FormMessage />
                                            </FormItem>
                                        );
                                    }}
                                />
                                {sshSudoMode === "commands" && (
                                    <FormField
                                        control={form.control}
                                        name="sshSudoCommands"
                                        render={({ field }) => (
                                            <FormItem>
                                                <FormLabel>
                                                    {t("sshSudoCommands")}
                                                </FormLabel>
                                                <FormControl>
                                                    <Textarea
                                                        {...field}
                                                        {...getTextImportDropHandlers(
                                                            "sshSudoCommands"
                                                        )}
                                                        placeholder={
                                                            sshDisabled
                                                                ? undefined
                                                                : t(
                                                                      "roleTextFieldPlaceholder"
                                                                  )
                                                        }
                                                        disabled={sshDisabled}
                                                        className={cn(
                                                            "h-20 min-h-20",
                                                            dragOverField ===
                                                                "sshSudoCommands" &&
                                                                "border-primary"
                                                        )}
                                                    />
                                                </FormControl>
                                                <FormDescription>
                                                    {t(
                                                        "sshSudoCommandsDescription"
                                                    )}
                                                </FormDescription>
                                                <FormMessage />
                                            </FormItem>
                                        )}
                                    />
                                )}

                                <FormField
                                    control={form.control}
                                    name="sshUnixGroups"
                                    render={({ field }) => (
                                        <FormItem>
                                            <FormLabel>
                                                {t("sshUnixGroups")}
                                            </FormLabel>
                                            <FormControl>
                                                <Textarea
                                                    {...field}
                                                    {...getTextImportDropHandlers(
                                                        "sshUnixGroups"
                                                    )}
                                                    placeholder={
                                                        sshDisabled
                                                            ? undefined
                                                            : t(
                                                                  "roleTextFieldPlaceholder"
                                                              )
                                                    }
                                                    disabled={sshDisabled}
                                                    className={cn(
                                                        "h-20 min-h-20",
                                                        dragOverField ===
                                                            "sshUnixGroups" &&
                                                            "border-primary"
                                                    )}
                                                />
                                            </FormControl>
                                            <FormDescription>
                                                {t("sshUnixGroupsDescription")}
                                            </FormDescription>
                                            <FormMessage />
                                        </FormItem>
                                    )}
                                />

                                <FormField
                                    control={form.control}
                                    name="sshCreateHomeDir"
                                    render={({ field }) => (
                                        <FormItem className="my-2">
                                            <FormControl>
                                                <CheckboxWithLabel
                                                    {...field}
                                                    value="on"
                                                    checked={form.watch(
                                                        "sshCreateHomeDir"
                                                    )}
                                                    onCheckedChange={(
                                                        checked
                                                    ) => {
                                                        if (
                                                            checked !==
                                                            "indeterminate"
                                                        ) {
                                                            form.setValue(
                                                                "sshCreateHomeDir",
                                                                checked
                                                            );
                                                        }
                                                    }}
                                                    label={t(
                                                        "sshCreateHomeDir"
                                                    )}
                                                    disabled={sshDisabled}
                                                />
                                            </FormControl>
                                            <FormMessage />
                                        </FormItem>
                                    )}
                                />
                            </div>
                        )}
                    </HorizontalTabs>
                )}
            </form>
            {pendingImport && (
                <TextFileImportDialog
                    key={`${pendingImport.field}-${pendingImport.fileName}`}
                    open={true}
                    onOpenChange={(open) => {
                        if (!open) {
                            setPendingImport(null);
                        }
                    }}
                    fileName={pendingImport.fileName}
                    fileType={pendingImport.fileType}
                    rawContent={pendingImport.rawContent}
                    currentValue={form.watch(pendingImport.field) ?? ""}
                    fieldLabel={
                        pendingImport.field === "sshSudoCommands"
                            ? t("sshSudoCommands")
                            : t("sshUnixGroups")
                    }
                    parser={
                        pendingImport.field === "sshSudoCommands"
                            ? parseSudoCommands
                            : parseUnixGroups
                    }
                    onConfirm={(value) => {
                        form.setValue(pendingImport.field, value, {
                            shouldDirty: true,
                            shouldValidate: true
                        });
                        setPendingImport(null);
                    }}
                />
            )}
        </Form>
    );
}
