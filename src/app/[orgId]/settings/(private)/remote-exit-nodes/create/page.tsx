"use client";

import {
    SettingsContainer,
    SettingsSection,
    SettingsSectionBody,
    SettingsSectionDescription,
    SettingsSectionForm,
    SettingsSectionHeader,
    SettingsSectionTitle
} from "@app/components/Settings";
import {
    Form,
    FormControl,
    FormDescription,
    FormField,
    FormItem,
    FormLabel,
    FormMessage
} from "@app/components/ui/form";
import { z } from "zod";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Input } from "@app/components/ui/input";
import { Button } from "@app/components/ui/button";
import CopyTextBox from "@app/components/CopyTextBox";
import { createApiClient, formatAxiosError } from "@app/lib/api";
import { useEnvContext } from "@app/hooks/useEnvContext";
import {
    QuickStartRemoteExitNodeResponse,
    PickRemoteExitNodeDefaultsResponse
} from "@server/routers/remoteExitNode/types";
import { toast } from "@app/hooks/useToast";
import { AxiosResponse } from "axios";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import HeaderTitle from "@app/components/SettingsSectionTitle";
import { StrategySelect } from "@app/components/StrategySelect";

export default function CreateRemoteExitNodePage() {
    const { env } = useEnvContext();
    const api = createApiClient({ env });
    const { orgId } = useParams();
    const router = useRouter();
    const searchParams = useSearchParams();
    const t = useTranslations();

    const [isLoading, setIsLoading] = useState(false);
    const [defaults, setDefaults] =
        useState<PickRemoteExitNodeDefaultsResponse | null>(null);
    const [createdNode, setCreatedNode] =
        useState<QuickStartRemoteExitNodeResponse | null>(null);
    const [strategy, setStrategy] = useState<"adopt" | "generate">("adopt");

    const createRemoteExitNodeFormSchema = z
        .object({
            remoteExitNodeId: z.string().optional(),
            secret: z.string().optional()
        })
        .refine(
            (data) => {
                if (strategy === "adopt") {
                    return data.remoteExitNodeId && data.secret;
                }
                return true;
            },
            {
                message: t("remoteExitNodeCreate.validation.adoptRequired"),
                path: ["remoteExitNodeId"]
            }
        );

    type CreateRemoteExitNodeFormValues = z.infer<
        typeof createRemoteExitNodeFormSchema
    >;

    const form = useForm<CreateRemoteExitNodeFormValues>({
        resolver: zodResolver(createRemoteExitNodeFormSchema),
        defaultValues: {}
    });

    // Check for query parameters and prefill form
    useEffect(() => {
        const remoteExitNodeId = searchParams.get("remoteExitNodeId");
        const remoteExitNodeSecret = searchParams.get("remoteExitNodeSecret");

        if (remoteExitNodeId && remoteExitNodeSecret) {
            setStrategy("adopt");
            form.setValue("remoteExitNodeId", remoteExitNodeId);
            form.setValue("secret", remoteExitNodeSecret);
        }
    }, []);

    useEffect(() => {
        const loadDefaults = async () => {
            try {
                const response = await api.get<
                    AxiosResponse<PickRemoteExitNodeDefaultsResponse>
                >(`/org/${orgId}/pick-remote-exit-node-defaults`);
                setDefaults(response.data.data);
            } catch (error) {
                toast({
                    title: t("error"),
                    description: t(
                        "remoteExitNodeCreate.errors.loadDefaultsFailed"
                    ),
                    variant: "destructive"
                });
            }
        };

        // Only load defaults when strategy is "generate"
        if (strategy === "generate") {
            loadDefaults();
        }
    }, [strategy]);

    const onSubmit = async (data: CreateRemoteExitNodeFormValues) => {
        if (strategy === "generate" && !defaults) {
            toast({
                title: t("error"),
                description: t("remoteExitNodeCreate.errors.defaultsNotLoaded"),
                variant: "destructive"
            });
            return;
        }

        if (strategy === "adopt" && (!data.remoteExitNodeId || !data.secret)) {
            toast({
                title: t("error"),
                description: t("remoteExitNodeCreate.validation.adoptRequired"),
                variant: "destructive"
            });
            return;
        }

        setIsLoading(true);
        try {
            const response = await api.put<
                AxiosResponse<QuickStartRemoteExitNodeResponse>
            >(`/org/${orgId}/remote-exit-node`, {
                remoteExitNodeId:
                    strategy === "generate"
                        ? defaults!.remoteExitNodeId
                        : data.remoteExitNodeId!,
                secret:
                    strategy === "generate" ? defaults!.secret : data.secret!
            });
            setCreatedNode(response.data.data);

            router.push(`/${orgId}/settings/remote-exit-nodes`);
        } catch (error) {
            toast({
                title: t("error"),
                description: formatAxiosError(
                    error,
                    t("remoteExitNodeCreate.errors.createFailed")
                ),
                variant: "destructive"
            });
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <>
            <div className="flex justify-between">
                <HeaderTitle
                    title={t("remoteExitNodeCreate.title")}
                    description={t("remoteExitNodeCreate.description")}
                />
                <Button
                    variant="outline"
                    onClick={() => {
                        router.push(`/${orgId}/settings/remote-exit-nodes`);
                    }}
                >
                    {t("remoteExitNodeCreate.viewAllButton")}
                </Button>
            </div>

            <div>
                <SettingsContainer>
                    <SettingsSection>
                        <SettingsSectionHeader>
                            <SettingsSectionTitle>
                                {t("remoteExitNodeCreate.strategy.title")}
                            </SettingsSectionTitle>
                            <SettingsSectionDescription>
                                {t("remoteExitNodeCreate.strategy.description")}
                            </SettingsSectionDescription>
                        </SettingsSectionHeader>
                        <SettingsSectionBody>
                            <StrategySelect
                                options={[
                                    {
                                        id: "adopt",
                                        title: t(
                                            "remoteExitNodeCreate.strategy.adopt.title"
                                        ),
                                        description: t(
                                            "remoteExitNodeCreate.strategy.adopt.description"
                                        )
                                    },
                                    {
                                        id: "generate",
                                        title: t(
                                            "remoteExitNodeCreate.strategy.generate.title"
                                        ),
                                        description: t(
                                            "remoteExitNodeCreate.strategy.generate.description"
                                        )
                                    }
                                ]}
                                defaultValue={strategy}
                                onChange={(value) => {
                                    setStrategy(value);
                                    // Clear adopt fields when switching to generate
                                    if (value === "generate") {
                                        form.setValue("remoteExitNodeId", "");
                                        form.setValue("secret", "");
                                    }
                                }}
                                cols={2}
                            />
                        </SettingsSectionBody>
                    </SettingsSection>

                    {strategy === "adopt" && (
                        <SettingsSection>
                            <SettingsSectionHeader>
                                <SettingsSectionTitle>
                                    {t("remoteExitNodeCreate.adopt.title")}
                                </SettingsSectionTitle>
                                <SettingsSectionDescription>
                                    {t(
                                        "remoteExitNodeCreate.adopt.description"
                                    )}
                                </SettingsSectionDescription>
                            </SettingsSectionHeader>
                            <SettingsSectionBody>
                                <SettingsSectionForm>
                                    <Form {...form}>
                                        <div className="space-y-4">
                                            <FormField
                                                control={form.control}
                                                name="remoteExitNodeId"
                                                render={({ field }) => (
                                                    <FormItem>
                                                        <FormLabel>
                                                            {t(
                                                                "remoteExitNodeCreate.adopt.nodeIdLabel"
                                                            )}
                                                        </FormLabel>
                                                        <FormControl>
                                                            <Input {...field} />
                                                        </FormControl>
                                                        <FormDescription>
                                                            {t(
                                                                "remoteExitNodeCreate.adopt.nodeIdDescription"
                                                            )}
                                                        </FormDescription>
                                                        <FormMessage />
                                                    </FormItem>
                                                )}
                                            />

                                            <FormField
                                                control={form.control}
                                                name="secret"
                                                render={({ field }) => (
                                                    <FormItem>
                                                        <FormLabel>
                                                            {t(
                                                                "remoteExitNodeCreate.adopt.secretLabel"
                                                            )}
                                                        </FormLabel>
                                                        <FormControl>
                                                            <Input
                                                                type="password"
                                                                {...field}
                                                            />
                                                        </FormControl>
                                                        <FormDescription>
                                                            {t(
                                                                "remoteExitNodeCreate.adopt.secretDescription"
                                                            )}
                                                        </FormDescription>
                                                        <FormMessage />
                                                    </FormItem>
                                                )}
                                            />
                                        </div>
                                    </Form>
                                </SettingsSectionForm>
                            </SettingsSectionBody>
                        </SettingsSection>
                    )}

                    {strategy === "generate" && (
                        <SettingsSection>
                            <SettingsSectionHeader>
                                <SettingsSectionTitle>
                                    {t("remoteExitNodeCreate.generate.title")}
                                </SettingsSectionTitle>
                                <SettingsSectionDescription>
                                    {t(
                                        "remoteExitNodeCreate.generate.description"
                                    )}
                                </SettingsSectionDescription>
                            </SettingsSectionHeader>
                            <SettingsSectionBody>
                                <CopyTextBox
                                    text={`managed:
  id: "${defaults?.remoteExitNodeId}"
  secret: "${defaults?.secret}"`}
                                />
                            </SettingsSectionBody>
                        </SettingsSection>
                    )}
                </SettingsContainer>

                <div className="flex justify-end space-x-2 mt-8">
                    <Button
                        type="button"
                        variant="outline"
                        onClick={() => {
                            router.push(`/${orgId}/settings/remote-exit-nodes`);
                        }}
                    >
                        {t("cancel")}
                    </Button>
                    <Button
                        type="button"
                        loading={isLoading}
                        disabled={isLoading}
                        onClick={() => {
                            form.handleSubmit(onSubmit)();
                        }}
                    >
                        {strategy === "adopt"
                            ? t("remoteExitNodeCreate.adopt.submitButton")
                            : t("remoteExitNodeCreate.generate.submitButton")}
                    </Button>
                </div>
            </div>
        </>
    );
}
