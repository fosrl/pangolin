import { GetDomainResponse } from "@server/routers/domain/getDomain";
import { createContext, useContext } from "react";
interface DomainContextType {
    domain: GetDomainResponse;
    updateDomain: (updatedDomain: Partial<GetDomainResponse>) => void;
    orgId: string;
}

const DomainContext = createContext<DomainContextType | undefined>(undefined);

export function useDomain() {
    const context = useContext(DomainContext);
    if (!context) {
        throw new Error("useDomain must be used within DomainProvider");
    }
    return context;
}

export default DomainContext;