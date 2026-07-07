"use client";

import { createContext, useContext, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import type { GetResourcePolicyResponse } from "@server/routers/policy";

interface ResourcePolicyProviderProps {
    children: React.ReactNode;
    policy: GetResourcePolicyResponse;
}

export function ResourcePolicyProvider({
    children,
    policy: serverPolicy
}: ResourcePolicyProviderProps) {
    const [policy, setPolicy] =
        useState<GetResourcePolicyResponse>(serverPolicy);

    useEffect(() => {
        setPolicy(serverPolicy);
    }, [serverPolicy]);

    const t = useTranslations();

    const updatePolicy = (
        updatedPolicy: Partial<GetResourcePolicyResponse>
    ) => {
        if (!policy) {
            throw new Error(t("resourceErrorNoUpdate"));
        }

        setPolicy((prev) => {
            if (!prev) {
                return prev;
            }

            return {
                ...prev,
                ...updatedPolicy
            };
        });
    };

    return (
        <ResourcePolicyContext value={{ policy, updatePolicy }}>
            {children}
        </ResourcePolicyContext>
    );
}

export type ResourcePolicyContextType = {
    policy: GetResourcePolicyResponse;
    updatePolicy: (updatedPolicy: Partial<GetResourcePolicyResponse>) => void;
};

export const ResourcePolicyContext = createContext<
    ResourcePolicyContextType | undefined
>(undefined);

export function useResourcePolicyContext() {
    const context = useContext(ResourcePolicyContext);
    if (context === undefined) {
        throw new Error(
            "useResourcePolicyContext must be used within a ResourcePolicyProvider"
        );
    }
    return context;
}
