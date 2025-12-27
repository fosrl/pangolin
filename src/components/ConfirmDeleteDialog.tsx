"use client";

import { Button } from "@app/components/ui/button";
import {
    Form,
    FormControl,
    FormField,
    FormItem,
    FormMessage
} from "@app/components/ui/form";
import { Input } from "@app/components/ui/input";
import { zodResolver } from "@hookform/resolvers/zod";
import React, { useActionState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import {
    Credenza,
    CredenzaBody,
    CredenzaClose,
    CredenzaContent,
    CredenzaFooter,
    CredenzaHeader,
    CredenzaTitle
} from "@app/components/Credenza";
import { useTranslations } from "next-intl";
import CopyToClipboard from "./CopyToClipboard";

type InviteUserFormProps = {
    open: boolean;
    setOpen: (open: boolean) => void;
    string: string;
    title: string;
    dialog: React.ReactNode;
    buttonText: string;
    onConfirm: () => Promise<void>;
    warningText?: string;
};

export default function ConfirmDeleteDialog({
    open,
    setOpen,
    string,
    title,
    onConfirm,
    buttonText,
    dialog,
    warningText
}: InviteUserFormProps) {
    const [, formAction, loading] = useActionState(onSubmit, null);

    const t = useTranslations();

    const formSchema = z.object({
        string: z.string().refine((val) => val === string, {
            message: t("inviteErrorInvalidConfirmation")
        })
    });

    const form = useForm<z.infer<typeof formSchema>>({
        resolver: zodResolver(formSchema),
        defaultValues: {
            string: ""
        }
    });

    const isConfirmed = form.watch("string") === string;

    async function onSubmit() {
        try {
            await onConfirm();
            setOpen(false);
            form.reset();
        } catch (error) {
            // Handle error if needed
            console.error("Confirmation failed:", error);
        }
    }

    return (
        <>
            <Credenza
                open={open}
                onOpenChange={(val) => {
                    setOpen(val);
                    form.reset();
                }}
            >
                <CredenzaContent>
                    <CredenzaHeader>
                        <CredenzaTitle>{title}</CredenzaTitle>
                    </CredenzaHeader>
                    <CredenzaBody>
                        <div className="mb-4 break-all overflow-hidden">
                            {dialog}
                            <div className="mt-2 mb-6 font-bold text-destructive">
                                {warningText || t("cannotbeUndone")}
                            </div>

                            <div>
                                <div className="flex items-center gap-2">
                                    <span>{t("type")}</span>
                                    <div className="px-2 py-1 rounded-md bg-secondary max-w-[250px] overflow-x-auto whitespace-nowrap scrollbar-thin scrollbar-thumb-muted scrollbar-track-transparent">
                                        <CopyToClipboard text={string} />
                                    </div>
                                    <span>{t("toConfirm")}</span>
                                </div>
                            </div>
                        </div>
                        <Form {...form}>
                            <form
                                action={formAction}
                                className="space-y-4"
                                id="confirm-delete-form"
                            >
                                <FormField
                                    control={form.control}
                                    name="string"
                                    render={({ field }) => (
                                        <FormItem>
                                            <FormControl>
                                                <Input
                                                    {...field}
                                                    placeholder={t(
                                                        "enterConfirmation"
                                                    )}
                                                />
                                            </FormControl>
                                            <FormMessage />
                                        </FormItem>
                                    )}
                                />
                            </form>
                        </Form>
                    </CredenzaBody>
                    <CredenzaFooter>
                        <CredenzaClose asChild>
                            <Button variant="outline">{t("close")}</Button>
                        </CredenzaClose>
                        <Button
                            variant={"destructive"}
                            type="submit"
                            form="confirm-delete-form"
                            loading={loading}
                            disabled={loading || !isConfirmed}
                            className={!isConfirmed && !loading ? "opacity-50" : ""}
                        >
                            {buttonText}
                        </Button>
                    </CredenzaFooter>
                </CredenzaContent>
            </Credenza>
        </>
    );
}
