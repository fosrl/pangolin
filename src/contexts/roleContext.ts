import type { Role } from "@server/db";
import { createContext } from "react";

type RoleContextType = {
    role: Role;
    updateRole: (updatedRole: Partial<Role>) => void;
};

const RoleContext = createContext<RoleContextType | undefined>(undefined);

export default RoleContext;
