import { createContext } from "react";
import type { AiProviderPublic } from "@server/routers/aiProvider/types";

export type AiProviderContextType = {
    provider: AiProviderPublic;
    updateProvider: (updated: Partial<AiProviderPublic>) => void;
};

const AiProviderContext = createContext<AiProviderContextType | undefined>(
    undefined
);

export default AiProviderContext;
