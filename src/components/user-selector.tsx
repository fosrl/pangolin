import { orgQueries } from "@app/lib/queries";
import { getUserDisplayName } from "@app/lib/getUserDisplayName";
import { useQuery } from "@tanstack/react-query";
import {
    Command,
    CommandEmpty,
    CommandGroup,
    CommandInput,
    CommandItem,
    CommandList
} from "./ui/command";
import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { CheckIcon } from "lucide-react";
import { cn } from "@app/lib/cn";
import { useDebounce } from "use-debounce";
import type { SelectedUser } from "./users-selector";

export type { SelectedUser };

export type UserSelectorProps = {
    orgId: string;
    selectedUser?: SelectedUser | null;
    onSelectUser: (user: SelectedUser | null) => void;
    allowClear?: boolean;
    showClear?: boolean;
    onClear?: () => void;
    unassignedOption?: {
        label: string;
        selected: boolean;
        onSelect: () => void;
    };
};

export function UserSelector({
    orgId,
    selectedUser,
    onSelectUser,
    allowClear = true,
    showClear = false,
    onClear,
    unassignedOption
}: UserSelectorProps) {
    const t = useTranslations();
    const [userSearchQuery, setUserSearchQuery] = useState("");
    const [debouncedValue] = useDebounce(userSearchQuery, 150);

    const { data: users = [] } = useQuery(
        orgQueries.users({ orgId, perPage: 10, query: debouncedValue })
    );

    const usersShown = useMemo(() => {
        const allUsers: Array<SelectedUser> = users.map((u) => ({
            id: u.id,
            text: getUserDisplayName(u)
        }));
        if (
            debouncedValue.trim().length === 0 &&
            selectedUser &&
            !allUsers.find((user) => user.id === selectedUser.id)
        ) {
            allUsers.unshift(selectedUser);
        }
        return allUsers;
    }, [users, selectedUser, debouncedValue]);

    return (
        <Command shouldFilter={false}>
            <CommandInput
                placeholder={t("userSearch")}
                value={userSearchQuery}
                onValueChange={setUserSearchQuery}
            />
            <CommandList>
                <CommandEmpty>{t("usersNotFound")}</CommandEmpty>
                <CommandGroup>
                    {showClear && onClear && (
                        <CommandItem
                            onSelect={onClear}
                            className="text-muted-foreground"
                        >
                            {t("accessFilterClear")}
                        </CommandItem>
                    )}
                    {allowClear && (
                        <CommandItem
                            value="__none__"
                            onSelect={() => {
                                onSelectUser(null);
                            }}
                        >
                            <CheckIcon
                                className={cn(
                                    "mr-2 h-4 w-4",
                                    !selectedUser ? "opacity-100" : "opacity-0"
                                )}
                            />
                            {t("none")}
                        </CommandItem>
                    )}
                    {unassignedOption && (
                        <CommandItem
                            value="__unassigned__"
                            onSelect={unassignedOption.onSelect}
                        >
                            <CheckIcon
                                className={cn(
                                    "mr-2 h-4 w-4",
                                    unassignedOption.selected
                                        ? "opacity-100"
                                        : "opacity-0"
                                )}
                            />
                            {unassignedOption.label}
                        </CommandItem>
                    )}
                    {usersShown.map((user) => (
                        <CommandItem
                            value={`${user.text}:${user.id}`}
                            key={user.id}
                            onSelect={() => {
                                onSelectUser(user);
                            }}
                        >
                            <CheckIcon
                                className={cn(
                                    "mr-2 h-4 w-4",
                                    user.id === selectedUser?.id
                                        ? "opacity-100"
                                        : "opacity-0"
                                )}
                            />
                            {user.text}
                        </CommandItem>
                    ))}
                </CommandGroup>
            </CommandList>
        </Command>
    );
}
