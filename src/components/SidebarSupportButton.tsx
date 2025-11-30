"use client";

import React, { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { MessageCircle, CheckCircle2 } from "lucide-react";
import { useUserContext } from "@app/hooks/useUserContext";
import { useEnvContext } from "@app/hooks/useEnvContext";
import { createApiClient, formatAxiosError } from "@app/lib/api";
import { cn } from "@app/lib/cn";
import { useToast } from "@app/hooks/useToast";
import {
    Popover,
    PopoverContent,
    PopoverTrigger
} from "@app/components/ui/popover";
import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger
} from "@app/components/ui/tooltip";
import { Button } from "@app/components/ui/button";
import { Input } from "@app/components/ui/input";
import { Textarea } from "@app/components/ui/textarea";
import {
    Form,
    FormControl,
    FormField,
    FormItem,
    FormLabel,
    FormMessage
} from "@app/components/ui/form";
import { useTranslations } from "next-intl";

type SupportFormValues = {
    subject: string;
    body: string;
};

type SidebarSupportButtonProps = {
    isCollapsed: boolean;
};

export function SidebarSupportButton({
    isCollapsed
}: SidebarSupportButtonProps) {
    const [isOpen, setIsOpen] = useState(false);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [isSuccess, setIsSuccess] = useState(false);
    const { user } = useUserContext();
    const { env } = useEnvContext();
    const api = createApiClient({ env });
    const { toast } = useToast();
    const t = useTranslations();

    const form = useForm<SupportFormValues>({
        resolver: zodResolver(z.object({
            subject: z
                .string()
                .min(1, t("supportSubjectRequired"))
                .max(255, t("supportSubjectMaxLength")),
            body: z.string().min(1, t("supportMessageRequired"))
        })),
        defaultValues: {
            subject: "",
            body: ""
        }
    });

    const onSubmit = async (data: SupportFormValues) => {
        if (!user?.email) {
            toast({
                variant: "destructive",
                title: t("supportNotAvailableTitle"),
                description: t("supportNotAvailableDescription")
            });
            return;
        }

        setIsSubmitting(true);
        try {
            await api.post("/send-support-request", {
                subject: data.subject,
                body: data.body
            });

            setIsSuccess(true);

            toast({
                title: t("supportRequestSentTitle"),
                description: t("supportRequestSentDescription")
            });

            form.reset();
        } catch (error) {
            toast({
                variant: "destructive",
                title: t("supportRequestFailedTitle"),
                description: formatAxiosError(
                    error,
                    t("supportRequestFailedDescription")
                )
            });
        } finally {
            setIsSubmitting(false);
        }
    };

    if (!user?.email) {
        // Show message that support is not available
        return (
            <Popover open={isOpen} onOpenChange={setIsOpen}>
                {isCollapsed ? (
                    <TooltipProvider>
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <PopoverTrigger asChild>
                                    <Button
                                        size="icon"
                                        className="w-8 h-8"
                                        variant="ghost"
                                    >
                                        <MessageCircle className="h-4 w-4" />
                                    </Button>
                                </PopoverTrigger>
                            </TooltipTrigger>
                            <TooltipContent side="right" sideOffset={8}>
                                <p>{t("support", { defaultValue: "Support" })}</p>
                            </TooltipContent>
                        </Tooltip>
                    </TooltipProvider>
                ) : (
                    <PopoverTrigger asChild>
                        <Button
                            variant="ghost"
                            className="w-full justify-center gap-2"
                        >
                            <MessageCircle className="h-4 w-4" />
                            {t("support", { defaultValue: "Support" })}
                        </Button>
                    </PopoverTrigger>
                )}
                <PopoverContent className="w-80" align="start">
                    <p className="text-sm text-muted-foreground">
                        {t("supportNotAvailableDescription")}
                    </p>
                </PopoverContent>
            </Popover>
        );
    }

    return (
        <Popover
            open={isOpen}
            onOpenChange={(open) => {
                setIsOpen(open);
                if (!open) {
                    setIsSuccess(false);
                }
            }}
        >
            {isCollapsed ? (
                <TooltipProvider>
                    <Tooltip>
                        <TooltipTrigger asChild>
                            <PopoverTrigger asChild>
                                <Button
                                    size="icon"
                                    className="w-8 h-8"
                                    variant="outline"
                                >
                                    <MessageCircle className="h-4 w-4" />
                                </Button>
                            </PopoverTrigger>
                        </TooltipTrigger>
                        <TooltipContent side="right" sideOffset={8}>
                            <p>{t("messageSupport")}</p>
                        </TooltipContent>
                    </Tooltip>
                </TooltipProvider>
            ) : (
                <PopoverTrigger asChild>
                    <Button
                        variant="outline"
                        className="w-full justify-center gap-2"
                    >
                        <MessageCircle className="h-4 w-4" />
                        {t("messageSupport")}
                    </Button>
                </PopoverTrigger>
            )}
            <PopoverContent className="w-96" align="start">
                {isSuccess ? (
                    <div className="flex flex-col items-center justify-center py-8 space-y-4">
                        <CheckCircle2 className="h-16 w-16 text-green-500" />
                        <h3 className="text-lg font-semibold">{t("supportMessageSent")}</h3>
                        <p className="text-sm text-muted-foreground text-center">
                            {t("supportWillContact")}
                        </p>
                    </div>
                ) : (
                    <Form {...form}>
                        <form
                            onSubmit={form.handleSubmit(onSubmit)}
                            className="space-y-4"
                        >
                        <FormItem>
                            <FormLabel>{t("supportReplyTo")}</FormLabel>
                            <FormControl>
                                <Input
                                    value={user?.email || ""}
                                    disabled
                                />
                            </FormControl>
                        </FormItem>

                        <FormField
                            control={form.control}
                            name="subject"
                            render={({ field }) => (
                                <FormItem>
                                    <FormLabel>{t("supportSubject")}</FormLabel>
                                    <FormControl>
                                        <Input
                                            placeholder={t("supportSubjectPlaceholder")}
                                            disabled={isSubmitting}
                                            {...field}
                                        />
                                    </FormControl>
                                    <FormMessage />
                                </FormItem>
                            )}
                        />

                        <FormField
                            control={form.control}
                            name="body"
                            render={({ field }) => (
                                <FormItem>
                                    <FormLabel>{t("supportMessage")}</FormLabel>
                                    <FormControl>
                                        <Textarea
                                            placeholder={t("supportMessagePlaceholder")}
                                            rows={5}
                                            disabled={isSubmitting}
                                            {...field}
                                        />
                                    </FormControl>
                                    <FormMessage />
                                </FormItem>
                            )}
                        />

                        <div className="flex justify-end gap-2">
                            <Button
                                type="button"
                                variant="outline"
                                onClick={() => setIsOpen(false)}
                                disabled={isSubmitting}
                            >
                                {t("cancel")}
                            </Button>
                            <Button type="submit" disabled={isSubmitting} loading={isSubmitting}>
                                {t("supportSend")}
                            </Button>
                        </div>
                    </form>
                </Form>
                )}
            </PopoverContent>
        </Popover>
    );
}
