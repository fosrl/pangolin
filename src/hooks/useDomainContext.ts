import DomainContext from "@app/contexts/domainContext";
import { useContext } from "react";

export function useDomainContext() {
    const context = useContext(DomainContext);
    if (context === undefined) {
        throw new Error('useDomainContext must be used within a DomainProvider');
    }
    return context;
}