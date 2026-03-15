"use client";

import { Button } from "@app/components/ui/button";
import { Label } from "@app/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@app/components/ui/radio-group";
import {
    Credenza,
    CredenzaBody,
    CredenzaClose,
    CredenzaContent,
    CredenzaFooter,
    CredenzaHeader,
    CredenzaTitle
} from "@app/components/Credenza";
import { createApiClient, formatAxiosError } from "@app/lib/api";
import { useEnvContext } from "@app/hooks/useEnvContext";
import { toast } from "@app/hooks/useToast";
import { useRouter } from "next/navigation";
import { useState } from "react";

type Group = { groupId: number; name: string; sortOrder: number };

type MoveResourceToGroupDialogProps = {
    open: boolean;
    setOpen: (open: boolean) => void;
    resourceId: number;
    resourceName: string;
    currentGroupId: number | null;
    groups: Group[];
};

export default function MoveResourceToGroupDialog({
    open,
    setOpen,
    resourceId,
    resourceName,
    currentGroupId,
    groups
}: MoveResourceToGroupDialogProps) {
    const { env } = useEnvContext();
    const api = createApiClient({ env });
    const router = useRouter();
    const [selected, setSelected] = useState<string>(
        currentGroupId !== null ? String(currentGroupId) : "ungrouped"
    );
    const [loading, setLoading] = useState(false);

    async function handleMove() {
        setLoading(true);
        try {
            const groupId =
                selected === "ungrouped" ? null : Number(selected);
            await api.post(`/resource/${resourceId}`, { groupId });
            setOpen(false);
            router.refresh();
        } catch (e) {
            toast({
                variant: "destructive",
                title: "Error moving resource",
                description: formatAxiosError(e, "Could not move resource")
            });
        } finally {
            setLoading(false);
        }
    }

    return (
        <Credenza
            open={open}
            onOpenChange={(val) => {
                setOpen(val);
                if (!val) {
                    setSelected(
                        currentGroupId !== null
                            ? String(currentGroupId)
                            : "ungrouped"
                    );
                }
            }}
        >
            <CredenzaContent>
                <CredenzaHeader>
                    <CredenzaTitle>Move &quot;{resourceName}&quot; to Group</CredenzaTitle>
                </CredenzaHeader>
                <CredenzaBody>
                    <RadioGroup
                        value={selected}
                        onValueChange={setSelected}
                        className="space-y-2"
                    >
                        <div className="flex items-center space-x-2">
                            <RadioGroupItem value="ungrouped" id="ungrouped" />
                            <Label htmlFor="ungrouped">Ungrouped</Label>
                        </div>
                        {groups.map((group) => (
                            <div
                                key={group.groupId}
                                className="flex items-center space-x-2"
                            >
                                <RadioGroupItem
                                    value={String(group.groupId)}
                                    id={`group-${group.groupId}`}
                                />
                                <Label htmlFor={`group-${group.groupId}`}>
                                    {group.name}
                                </Label>
                            </div>
                        ))}
                    </RadioGroup>
                </CredenzaBody>
                <CredenzaFooter>
                    <CredenzaClose asChild>
                        <Button variant="outline">Cancel</Button>
                    </CredenzaClose>
                    <Button onClick={handleMove} disabled={loading}>
                        {loading ? "Moving..." : "Move"}
                    </Button>
                </CredenzaFooter>
            </CredenzaContent>
        </Credenza>
    );
}
