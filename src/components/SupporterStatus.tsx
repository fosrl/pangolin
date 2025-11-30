"use client";

import Image from "next/image";
import { Separator } from "@app/components/ui/separator";
import { useSupporterStatusContext } from "@app/hooks/useSupporterStatusContext";
import { useState, useTransition } from "react";
import {
    Popover,
    PopoverContent,
    PopoverTrigger
} from "@app/components/ui/popover";
import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
} from "@app/components/ui/tooltip";
import { Button } from "./ui/button";
import {
    Credenza,
    CredenzaBody,
    CredenzaClose,
    CredenzaContent,
    CredenzaDescription,
    CredenzaFooter,
    CredenzaHeader,
    CredenzaTitle
} from "./Credenza";
import { z } from "zod";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import {
    Form,
    FormControl,
    FormField,
    FormItem,
    FormLabel,
    FormMessage
} from "./ui/form";
import { Input } from "./ui/input";
import { toast } from "@app/hooks/useToast";
import { createApiClient, formatAxiosError } from "@app/lib/api";
import { useEnvContext } from "@app/hooks/useEnvContext";
import { AxiosResponse } from "axios";
import { ValidateSupporterKeyResponse } from "@server/routers/supporterKey";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
    Card,
    CardContent,
    CardFooter,
    CardHeader,
    CardTitle
} from "./ui/card";
import { Check, ExternalLink, Heart } from "lucide-react";
import confetti from "canvas-confetti";
import { useTranslations } from "next-intl";

interface SupporterStatusProps {
    isCollapsed?: boolean;
}

export default function SupporterStatus({ isCollapsed = false }: SupporterStatusProps) {
    const { supporterStatus, updateSupporterStatus } =
        useSupporterStatusContext();
    const [supportOpen, setSupportOpen] = useState(false);
    const [keyOpen, setKeyOpen] = useState(false);
    const [purchaseOptionsOpen, setPurchaseOptionsOpen] = useState(false);

    const { env } = useEnvContext();
    const api = createApiClient({ env });
    const t = useTranslations();

    const formSchema = z.object({
        githubUsername: z
            .string()
            .nonempty({ message: "GitHub username is required" }),
        key: z.string().nonempty({ message: "Supporter key is required" })
    });

    const form = useForm({
        resolver: zodResolver(formSchema),
        defaultValues: {
            githubUsername: "",
            key: ""
        }
    });

    async function hide() {
        await api.post("/supporter-key/hide");

        updateSupporterStatus({
            visible: false
        });
    }

    async function onSubmit(values: z.infer<typeof formSchema>) {
        try {
            const res = await api.post<
                AxiosResponse<ValidateSupporterKeyResponse>
            >("/supporter-key/validate", {
                githubUsername: values.githubUsername,
                key: values.key
            });

            const data = res.data.data;

            if (!data || !data.valid) {
                toast({
                    variant: "destructive",
                    title: t('supportKeyInvalid'),
                    description: t('supportKeyInvalidDescription')
                });
                return;
            }

            // Trigger the toast
            toast({
                variant: "default",
                title: t('supportKeyValid'),
                description: t('supportKeyValidDescription')
            });

            // Fireworks-style confetti
            const duration = 5 * 1000; // 5 seconds
            const animationEnd = Date.now() + duration;
            const defaults = {
                startVelocity: 30,
                spread: 360,
                ticks: 60,
                zIndex: 0,
                colors: ["#FFA500", "#FF4500", "#FFD700"] // Orange hues
            };

            function randomInRange(min: number, max: number) {
                return Math.random() * (max - min) + min;
            }

            const interval = setInterval(() => {
                const timeLeft = animationEnd - Date.now();

                if (timeLeft <= 0) {
                    clearInterval(interval);
                    return;
                }

                const particleCount = 50 * (timeLeft / duration);

                // Launch confetti from two random horizontal positions
                confetti({
                    ...defaults,
                    particleCount,
                    origin: {
                        x: randomInRange(0.1, 0.3),
                        y: Math.random() - 0.2
                    }
                });
                confetti({
                    ...defaults,
                    particleCount,
                    origin: {
                        x: randomInRange(0.7, 0.9),
                        y: Math.random() - 0.2
                    }
                });
            }, 250);

            setPurchaseOptionsOpen(false);
            setKeyOpen(false);

            updateSupporterStatus({
                visible: false
            });
        } catch (error) {
            toast({
                variant: "destructive",
                title: t('error'),
                description: formatAxiosError(
                    error,
                    t('supportKeyErrorValidationDescription')
                )
            });
            return;
        }
    }

    return (
        <>
            <Credenza
                open={purchaseOptionsOpen}
                onOpenChange={(val) => {
                    setPurchaseOptionsOpen(val);
                }}
            >
                <CredenzaContent className="max-w-3xl">
                    <CredenzaHeader>
                        <CredenzaTitle>
                            {t('supportKey')}
                        </CredenzaTitle>
                    </CredenzaHeader>
                    <CredenzaBody>
                        <p>
                            {t('supportKeyDescription')}
                        </p>

                        <p>
                            {t('supportKeyPet')}
                        </p>

                        <p>
                            {t('supportKeyPurchase')}{" "}
                            <Link
                                href="https://supporters.fossorial.io/"
                                target="_blank"
                                rel="noopener noreferrer"
                                className="underline"
                            >
                                {t('supportKeyPurchaseLink')}
                            </Link>{" "}
                            {t('supportKeyPurchase2')}{" "}
                            <Link
                                href="https://docs.pangolin.net/self-host/supporter-program"
                                target="_blank"
                                rel="noopener noreferrer"
                                className="underline"
                            >
                                {t('supportKeyLearnMore')}
                            </Link>
                        </p>

                        <div className="py-6">
                            <p className="mb-3 text-center">
                                {t('supportKeyOptions')}
                            </p>
                            <div className="grid md:grid-cols-2 grid-cols-1 gap-8">
                                <Card>
                                    <CardHeader>
                                        <CardTitle>{t('supportKetOptionFull')}</CardTitle>
                                    </CardHeader>
                                    <CardContent>
                                        <p className="text-4xl mb-6">$95</p>
                                        <ul className="space-y-3">
                                            <li className="flex items-center gap-2">
                                                <Check className="h-6 w-6 text-green-500" />
                                                <span className="text-muted-foreground">
                                                    {t('forWholeServer')}
                                                </span>
                                            </li>
                                            <li className="flex items-center gap-2">
                                                <Check className="h-6 w-6 text-green-500" />
                                                <span className="text-muted-foreground">
                                                    {t('lifetimePurchase')}
                                                </span>
                                            </li>
                                            <li className="flex items-center gap-2">
                                                <Check className="h-6 w-6 text-green-500" />
                                                <span className="text-muted-foreground">
                                                    {t('supporterStatus')}
                                                </span>
                                            </li>
                                        </ul>
                                    </CardContent>
                                    <CardFooter>
                                        <Link
                                            href="https://github.com/sponsors/fosrl/sponsorships?tier_id=474929"
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="w-full"
                                        >
                                            <Button className="w-full">
                                                {t('buy')}
                                            </Button>
                                        </Link>
                                    </CardFooter>
                                </Card>

                                <Card
                                    className={`${supporterStatus?.tier === "Limited Supporter" ? "opacity-50" : ""}`}
                                >
                                    <CardHeader>
                                        <CardTitle>{t('supportKeyOptionLimited')}</CardTitle>
                                    </CardHeader>
                                    <CardContent>
                                        <p className="text-4xl mb-6">$25</p>
                                        <ul className="space-y-3">
                                            <li className="flex items-center gap-2">
                                                <Check className="h-6 w-6 text-green-500" />
                                                <span className="text-muted-foreground">
                                                    {t('forFiveUsers')}
                                                </span>
                                            </li>
                                            <li className="flex items-center gap-2">
                                                <Check className="h-6 w-6 text-green-500" />
                                                <span className="text-muted-foreground">
                                                    {t('lifetimePurchase')}
                                                </span>
                                            </li>
                                            <li className="flex items-center gap-2">
                                                <Check className="h-6 w-6 text-green-500" />
                                                <span className="text-muted-foreground">
                                                    {t('supporterStatus')}
                                                </span>
                                            </li>
                                        </ul>
                                    </CardContent>
                                    <CardFooter>
                                        {supporterStatus?.tier !==
                                        "Limited Supporter" ? (
                                            <Link
                                                href="https://github.com/sponsors/fosrl/sponsorships?tier_id=463100"
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                className="w-full"
                                            >
                                                <Button className="w-full">
                                                    {t('buy')}
                                                </Button>
                                            </Link>
                                        ) : (
                                            <Button
                                                className="w-full"
                                                disabled={
                                                    supporterStatus?.tier ===
                                                    "Limited Supporter"
                                                }
                                            >
                                                {t('buy')}
                                            </Button>
                                        )}
                                    </CardFooter>
                                </Card>
                            </div>
                        </div>

                        <div className="w-full space-y-2">
                            <Button
                                className="w-full"
                                variant="outlinePrimary"
                                onClick={() => {
                                    setKeyOpen(true);
                                }}
                            >
                                {t('supportKeyRedeem')}
                            </Button>
                            <Button
                                variant="ghost"
                                className="w-full"
                                onClick={() => hide()}
                            >
                                {t('supportKeyHideSevenDays')}
                            </Button>
                        </div>
                    </CredenzaBody>
                    <CredenzaFooter>
                        <CredenzaClose asChild>
                            <Button variant="outline">{t('close')}</Button>
                        </CredenzaClose>
                    </CredenzaFooter>
                </CredenzaContent>
            </Credenza>

            <Credenza
                open={keyOpen}
                onOpenChange={(val) => {
                    setKeyOpen(val);
                }}
            >
                <CredenzaContent>
                    <CredenzaHeader>
                        <CredenzaTitle>{t('supportKeyEnter')}</CredenzaTitle>
                        <CredenzaDescription>
                            {t('supportKeyEnterDescription')}
                        </CredenzaDescription>
                    </CredenzaHeader>
                    <CredenzaBody>
                        <Form {...form}>
                            <form
                                onSubmit={form.handleSubmit(onSubmit)}
                                className="space-y-4"
                                id="form"
                            >
                                <FormField
                                    control={form.control}
                                    name="githubUsername"
                                    render={({ field }) => (
                                        <FormItem>
                                            <FormLabel>
                                                {t('githubUsername')}
                                            </FormLabel>
                                            <FormControl>
                                                <Input {...field} />
                                            </FormControl>
                                            <FormMessage />
                                        </FormItem>
                                    )}
                                />
                                <FormField
                                    control={form.control}
                                    name="key"
                                    render={({ field }) => (
                                        <FormItem>
                                            <FormLabel>{t('supportKeyInput')}</FormLabel>
                                            <FormControl>
                                                <Input {...field} />
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
                            <Button variant="outline">{t('close')}</Button>
                        </CredenzaClose>
                        <Button type="submit" form="form">
                            {t('submit')}
                        </Button>
                    </CredenzaFooter>
                </CredenzaContent>
            </Credenza>

            {supporterStatus?.visible ? (
                isCollapsed ? (
                    <TooltipProvider>
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <Button
                                    size="icon"
                                    className="w-8 h-8"
                                    onClick={() => {
                                        setPurchaseOptionsOpen(true);
                                    }}
                                >
                                    <Heart className="h-4 w-4" />
                                </Button>
                            </TooltipTrigger>
                            <TooltipContent side="right" sideOffset={8}>
                                <p>{t('supportKeyBuy')}</p>
                            </TooltipContent>
                        </Tooltip>
                    </TooltipProvider>
                ) : (
                    <Button
                        size="sm"
                        className="gap-2 w-full"
                        onClick={() => {
                            setPurchaseOptionsOpen(true);
                        }}
                    >
                        {t('supportKeyBuy')}
                    </Button>
                )
            ) : null}
        </>
    );
}
