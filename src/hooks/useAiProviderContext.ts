import AiProviderContext from "@app/contexts/aiProviderContext";
import { useContext } from "react";

export function useAiProviderContext() {
    const context = useContext(AiProviderContext);
    if (context === undefined) {
        throw new Error(
            "useAiProviderContext must be used within an AiProviderProvider"
        );
    }
    return context;
}
