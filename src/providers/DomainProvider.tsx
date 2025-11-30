"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { GetDomainResponse } from "@server/routers/domain/getDomain";
import DomainContext from "@app/contexts/domainContext";

interface DomainProviderProps {
    children: React.ReactNode;
    domain: GetDomainResponse;
    orgId: string;
}

export function DomainProvider({
    children,
    domain: serverDomain,
    orgId
}: DomainProviderProps) {
    const [domain, setDomain] = useState<GetDomainResponse>(serverDomain);

    const t = useTranslations();

    const updateDomain = (updatedDomain: Partial<GetDomainResponse>) => {
        if (!domain) {
            throw new Error(t('domainErrorNoUpdate'));
        }
        setDomain((prev) => {
            if (!prev) {
                return prev;
            }
            return {
                ...prev,
                ...updatedDomain
            };
        });
    };

    return (
        <DomainContext.Provider value={{ domain, updateDomain, orgId }}>
            {children}
        </DomainContext.Provider>
    );
}

export default DomainProvider;