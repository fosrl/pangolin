"use client";

import { Button } from "@app/components/ui/button";
import { Input } from "@app/components/ui/input";
import { Label } from "@app/components/ui/label";
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
import { z } from "zod";

const nameSchema = z.string().min(1).max(100);

type CreateResourceGroupDialogProps = {
    open: boolean;
    setOpen: (open: boolean) => void;
    orgId: string;
};

export default function CreateResourceGroupDialog({
    open,
    setOpen,
    orgId
}: CreateResourceGroupDialogProps) {
    const { env } = useEnvContext();
    const api = createApiClient({ env });
    const router = useRouter();
    const [name, setName] = useState("");
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    async function handleCreate() {
        const parsed = nameSchema.safeParse(name.trim());
        if (!parsed.success) {
            setError("Group name must be between 1 and 100 characters.");
            return;
        }
        setLoading(true);
        setError(null);
        try {
            await api.put(`/org/${orgId}/resource-group`, {
                name: parsed.data
            });
            setOpen(false);
            setName("");
            router.refresh();
        } catch (e) {
            toast({
                variant: "destructive",
                title: "Error creating group",
                description: formatAxiosError(e, "Could not create group")
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
                    setName("");
                    setError(null);
                }
            }}
        >
            <CredenzaContent>
                <CredenzaHeader>
                    <CredenzaTitle>Create Group</CredenzaTitle>
                </CredenzaHeader>
                <CredenzaBody>
                    <div className="space-y-2">
                        <Label htmlFor="group-name">Group Name</Label>
                        <Input
                            id="group-name"
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            placeholder="e.g. Production, Internal, ..."
                            onKeyDown={(e) => {
                                if (e.key === "Enter") handleCreate();
                            }}
                        />
                        {error && (
                            <p className="text-sm text-destructive">{error}</p>
                        )}
                    </div>
                </CredenzaBody>
                <CredenzaFooter>
                    <CredenzaClose asChild>
                        <Button variant="outline">Cancel</Button>
                    </CredenzaClose>
                    <Button onClick={handleCreate} disabled={loading}>
                        {loading ? "Creating..." : "Create"}
                    </Button>
                </CredenzaFooter>
            </CredenzaContent>
        </Credenza>
    );
}
