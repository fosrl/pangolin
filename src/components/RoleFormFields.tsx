"use client";

import {
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
import { PaidFeaturesAlert } from "@app/components/PaidFeaturesAlert";
import {
    SettingsFormCell,
    SettingsFormGrid,
    SettingsSection,
    SettingsSectionBody,
    SettingsSectionDescription,
    SettingsSectionFooter,
    SettingsSectionForm,
    SettingsSectionHeader,
    SettingsSectionTitle
} from "@app/components/Settings";
import { SwitchInput } from "@app/components/SwitchInput";
import { TextFileImportDialog } from "@app/components/TextFileImportDialog";
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
import { tierMatrix } from "@server/lib/billing/tierMatrix";
import type { Role } from "@server/db";
import { ExternalLink } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { useFormContext, useWatch } from "react-hook-form";
import { z } from "zod";

export const ROLE_CLIENT_SETTINGS_DOCS_URL =
    "https://docs.pangolin.net/manage/clients/server-side-settings";

export const SSH_SUDO_MODE_VALUES = ["none", "full", "commands"] as const;
export type SshSudoMode = (typeof SSH_SUDO_MODE_VALUES)[number];

type Translate = ReturnType<typeof useTranslations>;

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

function parseLines(value: string | undefined): string[] {
    if (!value?.trim()) return [];
    return value
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);
}

export const parseUnixGroups = parseLines;
export const parseSudoCommands = parseLines;

function hasOnlyAbsoluteSudoCommands(value: string | undefined): boolean {
    return parseSudoCommands(value).every((command) =>
        command.split(/\s+/)[0].startsWith("/")
    );
}

// ── Schemas ─────────────────────────────────────────────────────────────────

export function roleGeneralSchema(t: Translate) {
    return z.object({
        name: z
            .string({ message: t("nameRequired") })
            .min(1)
            .max(32),
        description: z.string().max(255).optional()
    });
}

export const roleApprovalsSchema = z.object({
    requireDeviceApproval: z.boolean().optional()
});

const roleSshShape = {
    allowSsh: z.boolean().optional(),
    sshSudoMode: z.enum(SSH_SUDO_MODE_VALUES),
    sshSudoCommands: z.string().optional(),
    sshCreateHomeDir: z.boolean().optional(),
    sshUnixGroups: z.string().optional()
};

export function refineRoleSsh(t: Translate) {
    return (
        values: { sshSudoMode: SshSudoMode; sshSudoCommands?: string },
        ctx: z.RefinementCtx
    ) => {
        if (
            values.sshSudoMode === "commands" &&
            !hasOnlyAbsoluteSudoCommands(values.sshSudoCommands)
        ) {
            ctx.addIssue({
                code: "custom",
                path: ["sshSudoCommands"],
                message: t("sshSudoCommandsAbsolutePathError")
            });
        }
    };
}

export function roleSshSchema(t: Translate) {
    return z.object(roleSshShape).superRefine(refineRoleSsh(t));
}

export type RoleSshValues = z.infer<ReturnType<typeof roleSshSchema>>;

export function roleSshValues(role: Role): RoleSshValues {
    return {
        allowSsh: (role as Role & { allowSsh?: boolean }).allowSsh ?? false,
        sshSudoMode: toSshSudoMode(role.sshSudoMode),
        sshSudoCommands: parseRoleJsonArray(role.sshSudoCommands).join("\n"),
        sshCreateHomeDir: role.sshCreateHomeDir ?? false,
        sshUnixGroups: parseRoleJsonArray(role.sshUnixGroups).join("\n")
    };
}

// The SSH fields sent to the API. The detailed SSH controls are only sent when
// the org has the feature.
export function roleSshPayload(
    values: RoleSshValues,
    sshControlsPaid: boolean
) {
    const payload: {
        allowSsh?: boolean;
        sshSudoMode?: SshSudoMode;
        sshSudoCommands?: string[];
        sshCreateHomeDir?: boolean;
        sshUnixGroups?: string[];
    } = { allowSsh: values.allowSsh };
    if (sshControlsPaid) {
        payload.sshSudoMode = values.sshSudoMode;
        payload.sshCreateHomeDir = values.sshCreateHomeDir;
        payload.sshSudoCommands =
            values.sshSudoMode === "commands"
                ? parseSudoCommands(values.sshSudoCommands)
                : [];
        payload.sshUnixGroups = parseUnixGroups(values.sshUnixGroups);
    }
    return payload;
}

// ── Layout ──────────────────────────────────────────────────────────────────

export function RoleFormSection({
    title,
    description,
    footer,
    children
}: {
    title: string;
    description: React.ReactNode;
    footer?: React.ReactNode;
    children: React.ReactNode;
}) {
    return (
        <SettingsSection>
            <SettingsSectionHeader>
                <SettingsSectionTitle>{title}</SettingsSectionTitle>
                <SettingsSectionDescription>
                    {description}
                </SettingsSectionDescription>
            </SettingsSectionHeader>
            <SettingsSectionBody>
                <SettingsSectionForm variant="half">
                    <SettingsFormGrid>{children}</SettingsFormGrid>
                </SettingsSectionForm>
            </SettingsSectionBody>
            {footer && <SettingsSectionFooter>{footer}</SettingsSectionFooter>}
        </SettingsSection>
    );
}

export function RoleClientSettingsDescription() {
    const t = useTranslations();
    return (
        <>
            {t("accessRoleClientSettingsDescription")}{" "}
            <a
                href={ROLE_CLIENT_SETTINGS_DOCS_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary hover:underline inline-flex items-center gap-1"
            >
                {t("learnMore")}
                <ExternalLink className="size-3.5 shrink-0" />
            </a>
        </>
    );
}

// ── Field groups (render inside a <Form> whose values include these fields) ─

export function RoleGeneralFields({
    readOnly = false
}: {
    readOnly?: boolean;
}) {
    const t = useTranslations();
    const form = useFormContext();
    return (
        <>
            <SettingsFormCell span="half">
                <FormField
                    control={form.control}
                    name="name"
                    render={({ field }) => (
                        <FormItem>
                            <FormLabel>{t("accessRoleName")}</FormLabel>
                            <FormControl>
                                <Input
                                    {...field}
                                    disabled={readOnly}
                                    readOnly={readOnly}
                                />
                            </FormControl>
                            <FormMessage />
                        </FormItem>
                    )}
                />
            </SettingsFormCell>
            <SettingsFormCell span="half">
                <FormField
                    control={form.control}
                    name="description"
                    render={({ field }) => (
                        <FormItem>
                            <FormLabel>{t("description")}</FormLabel>
                            <FormControl>
                                <Input
                                    {...field}
                                    disabled={readOnly}
                                    readOnly={readOnly}
                                />
                            </FormControl>
                            <FormMessage />
                        </FormItem>
                    )}
                />
            </SettingsFormCell>
        </>
    );
}

export function RoleApprovalFields() {
    const t = useTranslations();
    const form = useFormContext();
    const { isPaidUser } = usePaidStatus();
    return (
        <>
            <SettingsFormCell span="full">
                <PaidFeaturesAlert tiers={tierMatrix.deviceApprovals} />
            </SettingsFormCell>
            <SettingsFormCell span="full">
                <FormField
                    control={form.control}
                    name="requireDeviceApproval"
                    render={({ field }) => (
                        <FormItem>
                            <FormControl>
                                <SwitchInput
                                    id="requireDeviceApproval"
                                    label={t("requireDeviceApproval")}
                                    description={t(
                                        "requireDeviceApprovalDescription"
                                    )}
                                    checked={field.value ?? false}
                                    onCheckedChange={field.onChange}
                                    disabled={
                                        !isPaidUser(tierMatrix.deviceApprovals)
                                    }
                                />
                            </FormControl>
                            <FormMessage />
                        </FormItem>
                    )}
                />
            </SettingsFormCell>
        </>
    );
}

type RoleTextImportField = "sshSudoCommands" | "sshUnixGroups";

type PendingTextImport = {
    field: RoleTextImportField;
    fileName: string;
    fileType: TextImportFileType;
    rawContent: string;
};

export function RoleSshFields() {
    const t = useTranslations();
    const form = useFormContext();
    const { isPaidUser } = usePaidStatus();
    const allowSsh = useWatch({ control: form.control, name: "allowSsh" });
    // The detailed controls only apply when SSH is allowed and the org has the
    // feature.
    const sshDisabled =
        !isPaidUser(tierMatrix.roleBasedSSHControls) || !allowSsh;
    const sshSudoMode = useWatch({
        control: form.control,
        name: "sshSudoMode"
    });

    const [pendingImport, setPendingImport] =
        useState<PendingTextImport | null>(null);
    const [dragOverField, setDragOverField] =
        useState<RoleTextImportField | null>(null);

    async function handleFileDrop(file: File, field: RoleTextImportField) {
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
        const items = parseTextFileItems({
            content: rawContent,
            fileType,
            skipHeader: false,
            parser: parseLines
        });

        if (items.length === 0) {
            toast({
                variant: "destructive",
                title: t("roleTextImportEmpty"),
                description: t("roleTextImportEmptyDescription")
            });
            return;
        }

        setPendingImport({ field, fileName: file.name, fileType, rawContent });
    }

    function dropHandlers(field: RoleTextImportField) {
        return {
            onDragOver: (event: React.DragEvent<HTMLTextAreaElement>) => {
                event.preventDefault();
                event.stopPropagation();
                if (!sshDisabled) setDragOverField(field);
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
                if (file) void handleFileDrop(file, field);
            }
        };
    }

    function renderTextImportField(
        name: RoleTextImportField,
        label: string,
        description: string
    ) {
        return (
            <SettingsFormCell span="half">
                <FormField
                    control={form.control}
                    name={name}
                    render={({ field }) => (
                        <FormItem>
                            <FormLabel>{label}</FormLabel>
                            <FormControl>
                                <Textarea
                                    {...field}
                                    {...dropHandlers(name)}
                                    placeholder={
                                        sshDisabled
                                            ? undefined
                                            : t("roleTextFieldPlaceholder")
                                    }
                                    disabled={sshDisabled}
                                    className={cn(
                                        "h-20 min-h-20",
                                        dragOverField === name &&
                                            "border-primary"
                                    )}
                                />
                            </FormControl>
                            <FormDescription>{description}</FormDescription>
                            <FormMessage />
                        </FormItem>
                    )}
                />
            </SettingsFormCell>
        );
    }

    const sudoOptions: OptionSelectOption<SshSudoMode>[] = [
        { value: "none", label: t("sshSudoModeNone") },
        { value: "full", label: t("sshSudoModeFull") },
        { value: "commands", label: t("sshSudoModeCommands") }
    ];

    return (
        <>
            <SettingsFormCell span="full">
                <FormField
                    control={form.control}
                    name="allowSsh"
                    render={({ field }) => (
                        <FormItem>
                            <FormControl>
                                <SwitchInput
                                    id="allowSsh"
                                    label={t("roleAllowSsh")}
                                    description={t("roleAllowSshDescription")}
                                    checked={field.value ?? false}
                                    onCheckedChange={field.onChange}
                                />
                            </FormControl>
                            <FormMessage />
                        </FormItem>
                    )}
                />
            </SettingsFormCell>

            {/* Detailed SSH controls */}
            <>
                <SettingsFormCell span="full">
                    <PaidFeaturesAlert
                        tiers={tierMatrix.roleBasedSSHControls}
                    />
                </SettingsFormCell>
                <SettingsFormCell span="full">
                    <FormField
                        control={form.control}
                        name="sshSudoMode"
                        render={({ field }) => (
                            <FormItem>
                                <FormLabel>{t("sshSudoMode")}</FormLabel>
                                <OptionSelect<SshSudoMode>
                                    options={sudoOptions}
                                    value={field.value}
                                    onChange={field.onChange}
                                    cols={3}
                                    disabled={sshDisabled}
                                />
                                <FormMessage />
                            </FormItem>
                        )}
                    />
                </SettingsFormCell>
                {sshSudoMode === "commands" &&
                    renderTextImportField(
                        "sshSudoCommands",
                        t("sshSudoCommands"),
                        t("sshSudoCommandsDescription")
                    )}
                {renderTextImportField(
                    "sshUnixGroups",
                    t("sshUnixGroups"),
                    t("sshUnixGroupsDescription")
                )}
                <SettingsFormCell span="full">
                    <FormField
                        control={form.control}
                        name="sshCreateHomeDir"
                        render={({ field }) => (
                            <FormItem>
                                <FormControl>
                                    <SwitchInput
                                        id="sshCreateHomeDir"
                                        label={t("sshCreateHomeDir")}
                                        description={t(
                                            "sshCreateHomeDirDescription"
                                        )}
                                        checked={field.value ?? false}
                                        onCheckedChange={field.onChange}
                                        disabled={sshDisabled}
                                    />
                                </FormControl>
                                <FormMessage />
                            </FormItem>
                        )}
                    />
                </SettingsFormCell>
            </>

            {pendingImport && (
                <TextFileImportDialog
                    key={`${pendingImport.field}-${pendingImport.fileName}`}
                    open={true}
                    onOpenChange={(open) => {
                        if (!open) setPendingImport(null);
                    }}
                    fileName={pendingImport.fileName}
                    fileType={pendingImport.fileType}
                    rawContent={pendingImport.rawContent}
                    currentValue={form.getValues(pendingImport.field) ?? ""}
                    fieldLabel={
                        pendingImport.field === "sshSudoCommands"
                            ? t("sshSudoCommands")
                            : t("sshUnixGroups")
                    }
                    parser={parseLines}
                    onConfirm={(value) => {
                        form.setValue(pendingImport.field, value, {
                            shouldDirty: true,
                            shouldValidate: true
                        });
                        setPendingImport(null);
                    }}
                />
            )}
        </>
    );
}
