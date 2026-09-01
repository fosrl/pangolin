"use client";

import { MachinesSelector } from "@app/components/machines-selector";
import { RolesSelector } from "@app/components/roles-selector";
import { UsersSelector } from "@app/components/users-selector";
import { SettingsFormCell, SettingsFormGrid } from "@app/components/Settings";
import type { Tag } from "@app/components/tags/tag-input";
import {
    FormControl,
    FormField,
    FormItem,
    FormLabel,
    FormMessage
} from "@app/components/ui/form";
import type { PrivateResourceClient } from "@app/lib/privateResourceForm";
import { useTranslations } from "next-intl";
import type { Control } from "react-hook-form";

type AccessFormValues = {
    roles?: Tag[];
    users?: Tag[];
    clients?: PrivateResourceClient[];
};

type PrivateResourceAccessFieldsProps = {
    control: Control<AccessFormValues>;
    orgId: string;
    loading?: boolean;
    hasMachineClients?: boolean;
};

export function PrivateResourceAccessFields({
    control,
    orgId,
    loading = false,
    hasMachineClients = false
}: PrivateResourceAccessFieldsProps) {
    const t = useTranslations();

    if (loading) {
        return (
            <div className="text-sm text-muted-foreground">{t("loading")}</div>
        );
    }

    return (
        <SettingsFormGrid>
            <SettingsFormCell span="full">
                <FormField
                    control={control}
                    name="roles"
                    render={({ field }) => (
                        <FormItem className="flex flex-col items-start">
                            <FormLabel>{t("roles")}</FormLabel>
                            <FormControl>
                                <RolesSelector
                                    selectedRoles={field.value ?? []}
                                    orgId={orgId}
                                    restrictAdminRole
                                    onSelectRoles={(newRoles) => {
                                        field.onChange(newRoles);
                                    }}
                                />
                            </FormControl>
                            <FormMessage />
                        </FormItem>
                    )}
                />
            </SettingsFormCell>
            <SettingsFormCell span="full">
                <FormField
                    control={control}
                    name="users"
                    render={({ field }) => (
                        <FormItem className="flex flex-col items-start">
                            <FormLabel>{t("users")}</FormLabel>
                            <UsersSelector
                                selectedUsers={field.value ?? []}
                                orgId={orgId}
                                onSelectUsers={(newUsers) => {
                                    field.onChange(newUsers);
                                }}
                            />
                            <FormMessage />
                        </FormItem>
                    )}
                />
            </SettingsFormCell>
            {hasMachineClients && (
                <SettingsFormCell span="full">
                    <FormField
                        control={control}
                        name="clients"
                        render={({ field }) => (
                            <FormItem className="flex flex-col items-start">
                                <FormLabel>{t("machineClients")}</FormLabel>
                                <MachinesSelector
                                    selectedMachines={field.value ?? []}
                                    orgId={orgId}
                                    onSelectMachines={(machines) => {
                                        field.onChange(machines);
                                    }}
                                />
                                <FormMessage />
                            </FormItem>
                        )}
                    />
                </SettingsFormCell>
            )}
        </SettingsFormGrid>
    );
}
