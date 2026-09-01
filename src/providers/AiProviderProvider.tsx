"use client";

import AiProviderContext from "@app/contexts/aiProviderContext";
import type { AiProviderPublic } from "@server/routers/aiProvider/types";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";

type AiProviderProviderProps = {
    children: React.ReactNode;
    provider: AiProviderPublic;
};

export function AiProviderProvider({
    children,
    provider: serverProvider
}: AiProviderProviderProps) {
    const [provider, setProvider] = useState<AiProviderPublic>(serverProvider);
    const t = useTranslations();

    useEffect(() => {
        setProvider(serverProvider);
    }, [serverProvider]);

    const updateProvider = (updated: Partial<AiProviderPublic>) => {
        if (!provider) {
            throw new Error(t("aiProviderErrorNoUpdate"));
        }

        setProvider((prev) => {
            if (!prev) {
                return prev;
            }
            return {
                ...prev,
                ...updated
            };
        });
    };

    return (
        <AiProviderContext.Provider value={{ provider, updateProvider }}>
            {children}
        </AiProviderContext.Provider>
    );
}

export default AiProviderProvider;
