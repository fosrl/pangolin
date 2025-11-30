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
import { useForm } from "react-hook-form";
import { Input } from "./ui/input";
import Editor from "@monaco-editor/react";
import { cn } from "@app/lib/cn";
import type { GetBlueprintResponse } from "@server/routers/blueprints";
import { Alert, AlertDescription } from "./ui/alert";
import {
    InfoSection,
    InfoSectionContent,
    InfoSections,
    InfoSectionTitle
} from "./InfoSection";
import { Badge } from "./ui/badge";
import { Globe, Terminal, Webhook } from "lucide-react";

export type CreateBlueprintFormProps = {
    blueprint: GetBlueprintResponse;
};

export default function BlueprintDetailsForm({
    blueprint
}: CreateBlueprintFormProps) {
    const t = useTranslations();

    const form = useForm({
        disabled: true,
        defaultValues: {
            name: blueprint.name,
            contents: blueprint.contents
        }
    });

    return (
        <Form {...form}>
            <div className="flex flex-col gap-6">
                <Alert>
                    <AlertDescription>
                        <InfoSections cols={3}>
                            <InfoSection>
                                <InfoSectionTitle>
                                    {t("status")}
                                </InfoSectionTitle>
                                <InfoSectionContent>
                                    {blueprint.succeeded ? (
                                        <Badge variant="green">
                                            {t("success")}
                                        </Badge>
                                    ) : (
                                        <Badge variant="red">
                                            {t("failed", {
                                                fallback: "Failed"
                                            })}
                                        </Badge>
                                    )}
                                </InfoSectionContent>
                            </InfoSection>
                            <InfoSection>
                                <InfoSectionTitle>
                                    {t("source")}
                                </InfoSectionTitle>
                                <InfoSectionContent>
                                    {blueprint.source === "API" && (
                                        <Badge
                                            variant="secondary"
                                            className="inline-flex items-center gap-1 "
                                        >
                                            API
                                            <Webhook className="w-3 h-3 flex-none" />
                                        </Badge>
                                    )}
                                    {blueprint.source === "NEWT" && (
                                        <Badge
                                            variant="secondary"
                                            className="inline-flex items-center gap-1 "
                                        >
                                            <Terminal className="w-3 h-3 flex-none" />
                                            Newt CLI
                                        </Badge>
                                    )}
                                    {blueprint.source === "UI" && (
                                        <Badge
                                            variant="secondary"
                                            className="inline-flex items-center gap-1 "
                                        >
                                            <Globe className="w-3 h-3 flex-none" />
                                            Dashboard
                                        </Badge>
                                    )}{" "}
                                </InfoSectionContent>
                            </InfoSection>
                            <InfoSection>
                                <InfoSectionTitle>
                                    {t("appliedAt")}
                                </InfoSectionTitle>
                                <InfoSectionContent>
                                    <time
                                        className="text-muted-foreground"
                                        dateTime={blueprint.createdAt.toString()}
                                    >
                                        {new Date(
                                            blueprint.createdAt * 1000
                                        ).toLocaleString()}
                                    </time>
                                </InfoSectionContent>
                            </InfoSection>
                            {blueprint.message && (
                                <InfoSection>
                                    <InfoSectionTitle>
                                        {t("message")}
                                    </InfoSectionTitle>
                                    <InfoSectionContent>
                                        <p className="text-muted-foreground">
                                            {blueprint.message}
                                        </p>
                                    </InfoSectionContent>
                                </InfoSection>
                            )}
                        </InfoSections>
                    </AlertDescription>
                </Alert>
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
                                                {t("parsedContents")}
                                            </FormLabel>
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
                                                            },
                                                            readOnly: true
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
                </SettingsContainer>
            </div>
        </Form>
    );
}
