"use client";

import {
    FormControl,
    FormDescription,
    FormField,
    FormItem,
    FormLabel,
    FormMessage
} from "@app/components/ui/form";

import { useTranslations } from "next-intl";

import type { FieldValues, Path, UseFormReturn } from "react-hook-form";
import { RolesSelector, type SelectedRole } from "./roles-selector";

type OrgRolesTagFieldProps<TFieldValues extends FieldValues> = {
    form: Pick<
        UseFormReturn<TFieldValues>,
        "control" | "getValues" | "setValue" | "clearErrors"
    >;
    orgId: string;
    /** Field in the form that holds Tag[] (role tags). Default: `"roles"`. */
    name?: Path<TFieldValues>;
    label?: string;
    supportsMultipleRolesPerUser: boolean;
    showMultiRolePaywallMessage: boolean;
    paywallMessage: string;
    disabled?: boolean;
};

export default function OrgRolesTagField<TFieldValues extends FieldValues>({
    form,
    name = "roles" as Path<TFieldValues>,
    label,
    orgId,
    supportsMultipleRolesPerUser,
    showMultiRolePaywallMessage,
    paywallMessage,
    disabled
}: OrgRolesTagFieldProps<TFieldValues>) {
    const t = useTranslations();

    function setRoleTags(nextValue: SelectedRole[]) {
        const prev = form.getValues(name) as SelectedRole[];
        const next = supportsMultipleRolesPerUser
            ? nextValue
            : nextValue.length > 1
              ? [nextValue[nextValue.length - 1]]
              : nextValue;

        if (
            !supportsMultipleRolesPerUser &&
            next.length === 0 &&
            prev.length > 0
        ) {
            form.setValue(name, [prev[prev.length - 1]] as never, {
                shouldDirty: true
            });
            form.clearErrors(name);
            return;
        }

        form.setValue(name, next as never, { shouldDirty: true });

        if (next.length > 0) {
            form.clearErrors(name);
        }
    }

    return (
        <FormField
            control={form.control}
            name={name}
            render={({ field }) => {
                const selectedRoles = (field.value ?? []) as SelectedRole[];

                return (
                    <FormItem className="flex flex-col items-start">
                        <FormLabel>{label ?? t("roles")}</FormLabel>
                        <FormControl>
                            <RolesSelector
                                orgId={orgId}
                                selectedRoles={selectedRoles}
                                onSelectRoles={setRoleTags}
                                disabled={disabled}
                            />
                        </FormControl>
                        {showMultiRolePaywallMessage && (
                            <FormDescription>{paywallMessage}</FormDescription>
                        )}
                        <FormMessage />
                    </FormItem>
                );
            }}
        />
    );
}
