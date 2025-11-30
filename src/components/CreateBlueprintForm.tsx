"use client";
import {
    SettingsContainer,
    SettingsSection,
    SettingsSectionBody,
    SettingsSectionForm,
    SettingsSectionHeader,
    SettingsSectionTitle
} from "@app/components/Settings";
import { useTranslations } from "next-intl";
import {
    Form,
    FormControl,
    FormDescription,
    FormField,
    FormItem,
    FormLabel,
    FormMessage
} from "@app/components/ui/form";
import { zodResolver } from "@hookform/resolvers/zod";
import z from "zod";
import { useForm } from "react-hook-form";
import { Input } from "./ui/input";
import { useActionState } from "react";
import Editor from "@monaco-editor/react";
import { cn } from "@app/lib/cn";
import { Button } from "./ui/button";
import { parse as parseYaml } from "yaml";
import { useEnvContext } from "@app/hooks/useEnvContext";
import { createApiClient, formatAxiosError } from "@app/lib/api";
import { AxiosResponse } from "axios";
import type { CreateBlueprintResponse } from "@server/routers/blueprints";
import { toast } from "@app/hooks/useToast";
import { useRouter } from "next/navigation";

export type CreateBlueprintFormProps = {
    orgId: string;
};

export default function CreateBlueprintForm({
    orgId
}: CreateBlueprintFormProps) {
    const t = useTranslations();
    const { env } = useEnvContext();
    const api = createApiClient({ env });
    const [, formAction, isSubmitting] = useActionState(onSubmit, null);
    const router = useRouter();

    const form = useForm({
        resolver: zodResolver(
            z.object({
                name: z.string().min(1).max(255),
                contents: z
                    .string()
                    .min(1)
                    .superRefine((contents, ctx) => {
                        try {
                            parseYaml(contents);
                        } catch (error) {
                            ctx.addIssue({
                                code: z.ZodIssueCode.custom,
                                message: `Invalid YAML: ${error instanceof Error ? error.message : "Unknown error"}`
                            });
                        }
                    })
            })
        ),
        defaultValues: {
            name: "",
            contents: `# Example blueprint
# proxy-resources:
#     resource-nice-id-uno:
#         name: this is my resource
#         protocol: http
#         full-domain: never-gonna-give-you-up.example.com
#         targets:
#             - site: lively-yosemite-toad
#               hostname: localhost
#               method: http
#               port: 8000
`
        }
    });

    async function onSubmit() {
        const isValid = await form.trigger();

        if (!isValid) return;

        const res = await api
            .put<AxiosResponse<CreateBlueprintResponse>>(
                `/org/${orgId}/blueprint/`,
                {
                    name: form.getValues("name"),
                    blueprint: form.getValues("contents")
                }
            )
            .catch((e) => {
                toast({
                    variant: "destructive",
                    title: t("resourceErrorCreate"),
                    description: formatAxiosError(
                        e,
                        t("blueprintErrorCreateDescription")
                    )
                });
            });

        if (res && res.status === 201) {
            const createdBlueprint = res.data.data;
            toast({
                variant: "warning",
                title: createdBlueprint.succeeded ? "Success" : "Warning",
                description: createdBlueprint.message
            });
            router.push(`/${orgId}/settings/blueprints`);
        }
    }
    return (
        <Form {...form}>
            <form action={formAction} id="base-resource-form">
                <SettingsContainer>
                    <SettingsSection>
                        <SettingsSectionHeader>
                            <SettingsSectionTitle>
                                {t("blueprintInfo")}
                            </SettingsSectionTitle>
                        </SettingsSectionHeader>
                        <SettingsSectionBody>
                            <SettingsSectionForm className="max-w-2xl">
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

                                <FormField
                                    control={form.control}
                                    name="contents"
                                    render={({ field }) => (
                                        <FormItem>
                                            <FormLabel>
                                                {t("contents")}
                                            </FormLabel>
                                            <FormDescription>
                                                {t(
                                                    "blueprintContentsDescription"
                                                )}
                                            </FormDescription>
                                            <FormControl>
                                                <div
                                                    className={cn(
                                                        "resize-y h-64 min-h-64 overflow-y-auto overflow-x-clip max-w-full rounded-md"
                                                    )}
                                                >
                                                    <Editor
                                                        className="w-full h-full max-w-full"
                                                        language="yaml"
                                                        theme="vs-dark"
                                                        options={{
                                                            minimap: {
                                                                enabled: false
                                                            }
                                                        }}
                                                        {...field}
                                                    />
                                                </div>
                                            </FormControl>
                                            <FormMessage />
                                        </FormItem>
                                    )}
                                />
                            </SettingsSectionForm>
                        </SettingsSectionBody>
                    </SettingsSection>

                    <div className="flex justify-end space-x-2 mt-8">
                        <Button type="submit" loading={isSubmitting}>
                            {t("actionApplyBlueprint")}
                        </Button>
                    </div>
                </SettingsContainer>
            </form>
        </Form>
    );
}
