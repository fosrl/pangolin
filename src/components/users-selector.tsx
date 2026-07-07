import { orgQueries } from "@app/lib/queries";
import type { ListUsersResponse } from "@server/routers/user";
import { getUserDisplayName } from "@app/lib/getUserDisplayName";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { useDebounce } from "use-debounce";

import { useTranslations } from "next-intl";
import { MultiSelectTagInput } from "./multi-select/multi-select-tag-input";

export type SelectedUser = {
    id: string;
    text: string;
    ipdName?: string | null;
};

export type UsersSelectorProps = {
    orgId: string;
    selectedUsers?: SelectedUser[];
    onSelectUsers: (users: SelectedUser[]) => void;
    disabled?: boolean;
    lockedIds?: Set<string>;
};

export function UsersSelector({
    orgId,
    selectedUsers = [],
    onSelectUsers,
    disabled,
    lockedIds
}: UsersSelectorProps) {
    const t = useTranslations();
    const [userSearchQuery, setUserSearchQuery] = useState("");

    const [debouncedValue] = useDebounce(userSearchQuery, 150);

    const { data: users = [] } = useQuery(
        orgQueries.users({ orgId, perPage: 10, query: debouncedValue })
    );

    // always include the selected users in the list (if the user isn't searching)
    const usersShown = useMemo(() => {
        const allUsers: Array<SelectedUser> = users.map((u) => ({
            id: u.id,
            text: getUserDisplayName(u)
        }));
        if (debouncedValue.trim().length === 0) {
            for (const user of selectedUsers) {
                if (!allUsers.find((u) => u.id === user.id)) {
                    allUsers.unshift(user);
                }
            }
        }
        return allUsers;
    }, [users, selectedUsers, debouncedValue]);

    return (
        <MultiSelectTagInput
            buttonText={t("alertingSelectUsers")}
            searchQuery={userSearchQuery}
            onSearch={setUserSearchQuery}
            options={usersShown}
            value={selectedUsers}
            onChange={onSelectUsers}
            disabled={disabled}
            lockedIds={lockedIds}
        />
    );
}
