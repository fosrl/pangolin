import RoleContext from "@app/contexts/roleContext";
import { useContext } from "react";

export function useRoleContext() {
    const context = useContext(RoleContext);
    if (context === undefined) {
        throw new Error("useRoleContext must be used within a RoleProvider");
    }
    return context;
}
