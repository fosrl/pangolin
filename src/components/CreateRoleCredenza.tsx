"use client";

import {
    Credenza,
    CredenzaBody,
    CredenzaClose,
    CredenzaContent,
    CredenzaDescription,
    CredenzaFooter,
    CredenzaHeader,
    CredenzaTitle
} from "@app/components/Credenza";
import {
    RoleGeneralFields,
    roleGeneralSchema
} from "@app/components/RoleFormFields";
import { Button } from "@app/components/ui/button";
import { Form } from "@app/components/ui/form";
import { useEnvContext } from "@app/hooks/useEnvContext";
import { toast } from "@app/hooks/useToast";
import { createApiClient, formatAxiosError } from "@app/lib/api";
import { zodResolver } from "@hookform/resolvers/zod";
import type { CreateRoleBody, CreateRoleResponse } from "@server/routers/role";
import type { AxiosResponse } from "axios";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { useForm } from "react-hook-form";
import type { z } from "zod";

const FORM_ID = "create-role-form";

type CreateRoleCredenzaProps = {
    orgId: string;
    open: boolean;
    setOpen: (open: boolean) => void;
};

// Creates a role from just a name and description, then opens the new role's
// settings pages to configure the rest.
export default function CreateRoleCredenza({
    orgId,
    open,
    setOpen
}: CreateRoleCredenzaProps) {
    const t = useTranslations();
    const router = useRouter();
    const api = createApiClient(useEnvContext());
    const [loading, startTransition] = useTransition();

    const schema = roleGeneralSchema(t);
    const form = useForm<z.infer<typeof schema>>({
        resolver: zodResolver(schema),
        defaultValues: { name: "", description: "" }
    });

    function onSubmit(values: z.infer<typeof schema>) {
        startTransition(async () => {
            const payload: CreateRoleBody = {
                name: values.name,
                description: values.description || undefined
            };
            try {
                const res = await api.put<AxiosResponse<CreateRoleResponse>>(
                    `/org/${orgId}/role`,
                    payload
                );
                toast({
                    variant: "default",
                    title: t("accessRoleCreated"),
                    description: t("accessRoleCreatedDescription")
                });
                router.push(
                    `/${orgId}/settings/access/roles/${res.data.data.roleId}/general`
                );
            } catch (e) {
                toast({
                    variant: "destructive",
                    title: t("accessRoleErrorCreate"),
                    description: formatAxiosError(
                        e,
                        t("accessRoleErrorCreateDescription")
                    )
                });
            }
        });
    }

    return (
        <Credenza
            open={open}
            onOpenChange={(value) => {
                setOpen(value);
                if (!value) form.reset();
            }}
        >
            <CredenzaContent>
                <CredenzaHeader>
                    <CredenzaTitle>{t("accessRoleCreate")}</CredenzaTitle>
                    <CredenzaDescription>
                        {t("accessRoleCreateDescription")}
                    </CredenzaDescription>
                </CredenzaHeader>
                <CredenzaBody>
                    <Form {...form}>
                        <form
                            id={FORM_ID}
                            className="space-y-4"
                            onSubmit={form.handleSubmit(onSubmit)}
                        >
                            <RoleGeneralFields />
                        </form>
                    </Form>
                </CredenzaBody>
                <CredenzaFooter>
                    <CredenzaClose asChild>
                        <Button variant="outline" disabled={loading}>
                            {t("cancel")}
                        </Button>
                    </CredenzaClose>
                    <Button
                        type="submit"
                        form={FORM_ID}
                        loading={loading}
                        disabled={loading}
                    >
                        {t("accessRoleCreateSubmit")}
                    </Button>
                </CredenzaFooter>
            </CredenzaContent>
        </Credenza>
    );
}
