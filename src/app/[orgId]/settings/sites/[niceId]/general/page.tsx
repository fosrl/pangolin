"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import {
    Form,
    FormControl,
    FormDescription,
    FormField,
    FormItem,
    FormLabel,
    FormMessage
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { useSiteContext } from "@app/hooks/useSiteContext";
import { useForm } from "react-hook-form";
import { toast } from "@app/hooks/useToast";
import { useRouter } from "next/navigation";
import {
    SettingsContainer,
    SettingsSection,
    SettingsSectionHeader,
    SettingsSectionTitle,
    SettingsSectionDescription,
    SettingsSectionBody,
    SettingsSectionForm
} from "@app/components/Settings";
import { formatAxiosError } from "@app/lib/api";
import { createApiClient } from "@app/lib/api";
import { useEnvContext } from "@app/hooks/useEnvContext";
import { useState } from "react";
import { SwitchInput } from "@app/components/SwitchInput";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { Tag, TagInput } from "@app/components/tags/tag-input";

const GeneralFormSchema = z.object({
    name: z.string().nonempty("Name is required"),
    dockerSocketEnabled: z.boolean().optional(),
    remoteSubnets: z
        .array(
            z.object({
                id: z.string(),
                text: z.string()
            })
        )
        .optional()
});

type GeneralFormValues = z.infer<typeof GeneralFormSchema>;

export default function GeneralPage() {
    const { site, updateSite } = useSiteContext();

    const { env } = useEnvContext();
    const api = createApiClient(useEnvContext());

    const [loading, setLoading] = useState(false);
    const [activeCidrTagIndex, setActiveCidrTagIndex] = useState<number | null>(
        null
    );

    const router = useRouter();
    const t = useTranslations();

    const form = useForm({
        resolver: zodResolver(GeneralFormSchema),
        defaultValues: {
            name: site?.name,
            dockerSocketEnabled: site?.dockerSocketEnabled ?? false,
            remoteSubnets: site?.remoteSubnets
                ? site.remoteSubnets.split(",").map((subnet, index) => ({
                      id: subnet.trim(),
                      text: subnet.trim()
                  }))
                : []
        },
        mode: "onChange"
    });

    async function onSubmit(data: GeneralFormValues) {
        setLoading(true);

        await api
            .post(`/site/${site?.siteId}`, {
                name: data.name,
                dockerSocketEnabled: data.dockerSocketEnabled,
                remoteSubnets:
                    data.remoteSubnets
                        ?.map((subnet) => subnet.text)
                        .join(",") || ""
            })
            .catch((e) => {
                toast({
                    variant: "destructive",
                    title: t("siteErrorUpdate"),
                    description: formatAxiosError(
                        e,
                        t("siteErrorUpdateDescription")
                    )
                });
            });

        updateSite({
            name: data.name,
            dockerSocketEnabled: data.dockerSocketEnabled,
            remoteSubnets:
                data.remoteSubnets?.map((subnet) => subnet.text).join(",") || ""
        });

        toast({
            title: t("siteUpdated"),
            description: t("siteUpdatedDescription")
        });

        setLoading(false);

        router.refresh();
    }

    return (
        <SettingsContainer>
            <SettingsSection>
                <SettingsSectionHeader>
                    <SettingsSectionTitle>
                        {t("generalSettings")}
                    </SettingsSectionTitle>
                    <SettingsSectionDescription>
                        {t("siteGeneralDescription")}
                    </SettingsSectionDescription>
                </SettingsSectionHeader>

                <SettingsSectionBody>
                    <SettingsSectionForm>
                        <Form {...form}>
                            <form
                                onSubmit={form.handleSubmit(onSubmit)}
                                className="space-y-6"
                                id="general-settings-form"
                            >
                                <FormField
                                    control={form.control}
                                    name="name"
                                    render={({ field }) => (
                                        <FormItem>
                                            <FormLabel>{t("name")}</FormLabel>
                                            <FormControl>
                                                <Input {...field} />
                                            </FormControl>
                                            <FormMessage />
                                        </FormItem>
                                    )}
                                />

                                {env.flags.enableClients &&
                                site.type === "newt" ? (
                                    <FormField
                                        control={form.control}
                                        name="remoteSubnets"
                                        render={({ field }) => (
                                            <FormItem>
                                                <FormLabel>
                                                    {t("remoteSubnets")}
                                                </FormLabel>
                                                <FormControl>
                                                    <TagInput
                                                        {...field}
                                                        activeTagIndex={
                                                            activeCidrTagIndex
                                                        }
                                                        setActiveTagIndex={
                                                            setActiveCidrTagIndex
                                                        }
                                                        placeholder={t(
                                                            "enterCidrRange"
                                                        )}
                                                        size="sm"
                                                        tags={
                                                            form.getValues()
                                                                .remoteSubnets ||
                                                            []
                                                        }
                                                        setTags={(
                                                            newSubnets
                                                        ) => {
                                                            form.setValue(
                                                                "remoteSubnets",
                                                                newSubnets as Tag[]
                                                            );
                                                        }}
                                                        validateTag={(tag) => {
                                                            // Basic CIDR validation regex
                                                            const cidrRegex =
                                                                /^(\d{1,3}\.){3}\d{1,3}\/\d{1,2}$/;
                                                            return cidrRegex.test(
                                                                tag
                                                            );
                                                        }}
                                                        allowDuplicates={false}
                                                        sortTags={true}
                                                    />
                                                </FormControl>
                                                <FormDescription>
                                                    {t(
                                                        "remoteSubnetsDescription"
                                                    )}
                                                </FormDescription>
                                                <FormMessage />
                                            </FormItem>
                                        )}
                                    />
                                ) : null}

                                {site && site.type === "newt" && (
                                    <FormField
                                        control={form.control}
                                        name="dockerSocketEnabled"
                                        render={({ field }) => (
                                            <FormItem>
                                                <FormControl>
                                                    <SwitchInput
                                                        id="docker-socket-enabled"
                                                        label={t(
                                                            "enableDockerSocket"
                                                        )}
                                                        defaultChecked={
                                                            field.value
                                                        }
                                                        onCheckedChange={
                                                            field.onChange
                                                        }
                                                    />
                                                </FormControl>
                                                <FormMessage />
                                                <FormDescription>
                                                    {t(
                                                        "enableDockerSocketDescription"
                                                    )}{" "}
                                                    <Link
                                                        href="https://docs.pangolin.net/manage/sites/configure-site#docker-socket-integration"
                                                        target="_blank"
                                                        rel="noopener noreferrer"
                                                        className="text-primary hover:underline inline-flex items-center"
                                                    >
                                                        <span>
                                                            {t(
                                                                "enableDockerSocketLink"
                                                            )}
                                                        </span>
                                                    </Link>
                                                </FormDescription>
                                            </FormItem>
                                        )}
                                    />
                                )}
                            </form>
                        </Form>
                    </SettingsSectionForm>
                </SettingsSectionBody>
            </SettingsSection>

            <div className="flex justify-end mt-6">
                <Button
                    type="submit"
                    form="general-settings-form"
                    loading={loading}
                    disabled={loading}
                >
                    Save All Settings
                </Button>
            </div>
        </SettingsContainer>
    );
}
