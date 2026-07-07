"use client";

import { type UseFormReturn } from "react-hook-form";
import type { PolicyFormValues } from ".";
import { PolicyAuthStackSectionCreate } from "./PolicyAuthStackSectionCreate";
import { PolicyAuthStackSectionEdit } from "./PolicyAuthStackSectionEdit";

type PolicyAuthStackSectionEditProps = {
    mode: "edit";
    orgId: string;
    allIdps: { id: number; text: string }[];
    emailEnabled: boolean;
    readonly?: boolean;
    resourceId?: number;
};

type PolicyAuthStackSectionCreateProps = {
    mode: "create";
    form: UseFormReturn<PolicyFormValues, any, any>;
    orgId: string;
    allIdps: { id: number; text: string }[];
    emailEnabled: boolean;
};

export type PolicyAuthStackSectionProps =
    | PolicyAuthStackSectionEditProps
    | PolicyAuthStackSectionCreateProps;

export function PolicyAuthStackSection(props: PolicyAuthStackSectionProps) {
    if (props.mode === "create") {
        const { mode: _, ...createProps } = props;
        return <PolicyAuthStackSectionCreate {...createProps} />;
    }
    const { mode: _, ...editProps } = props;
    return <PolicyAuthStackSectionEdit {...editProps} />;
}
