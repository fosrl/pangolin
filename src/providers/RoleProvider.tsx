"use client";

import RoleContext from "@app/contexts/roleContext";
import type { Role } from "@server/db";
import { useState } from "react";

type RoleProviderProps = {
    children: React.ReactNode;
    role: Role;
};

export function RoleProvider({
    children,
    role: serverRole
}: RoleProviderProps) {
    const [role, setRole] = useState<Role>(serverRole);

    const updateRole = (updatedRole: Partial<Role>) => {
        setRole((prev) => ({ ...prev, ...updatedRole }));
    };

    return (
        <RoleContext.Provider value={{ role, updateRole }}>
            {children}
        </RoleContext.Provider>
    );
}

export default RoleProvider;
