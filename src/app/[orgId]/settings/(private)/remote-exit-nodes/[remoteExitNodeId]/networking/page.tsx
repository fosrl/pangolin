"use client";

import { useEffect, useMemo, useState } from "react";
import {
    SettingsContainer,
    SettingsFormCell,
    SettingsFormGrid,
    SettingsSection,
    SettingsSectionBody,
    SettingsSectionDescription,
    SettingsSectionFooter,
    SettingsSectionForm,
    SettingsSectionHeader,
    SettingsSectionTitle
} from "@app/components/Settings";
import { Button } from "@app/components/ui/button";
import { Label } from "@app/components/ui/label";
import { createApiClient, formatAxiosError } from "@app/lib/api";
import { useEnvContext } from "@app/hooks/useEnvContext";
import { toast } from "@app/hooks/useToast";
import { useParams } from "next/navigation";
import { AxiosResponse } from "axios";
import { useRemoteExitNodeContext } from "@app/hooks/useRemoteExitNodeContext";
import { TagInput, type Tag } from "@app/components/tags/tag-input";
import { MultiSelectTagInput } from "@app/components/multi-select/multi-select-tag-input";
import type { TagValue } from "@app/components/multi-select/multi-select-content";
import { orgQueries } from "@app/lib/queries";
import { useQuery } from "@tanstack/react-query";
import { useDebounce } from "use-debounce";
import type { ListRemoteExitNodeResourcesResponse } from "@server/routers/remoteExitNode";
import type { SetRemoteExitNodeResourcesResponse } from "@server/routers/remoteExitNode";
import type { ListRemoteExitNodePreferenceLabelsResponse } from "@server/routers/remoteExitNode";
import type { SetRemoteExitNodePreferenceLabelsResponse } from "@server/routers/remoteExitNode";
import { useTranslations } from "next-intl";
import { ExternalLink } from "lucide-react";

const cidrRegex =
    /^(([0-9]|[1-9][0-9]|1[0-9]{2}|2[0-4][0-9]|25[0-5])\.){3}([0-9]|[1-9][0-9]|1[0-9]{2}|2[0-4][0-9]|25[0-5])(\/([0-9]|[1-2][0-9]|3[0-2]))$|^(([0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,7}:|([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2}|([0-9a-fA-F]{1,4}:){1,4}(:[0-9a-fA-F]{1,4}){1,3}|([0-9a-fA-F]{1,4}:){1,3}(:[0-9a-fA-F]{1,4}){1,4}|([0-9a-fA-F]{1,4}:){1,2}(:[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:((:[0-9a-fA-F]{1,4}){1,6})|:((:[0-9a-fA-F]{1,4}){1,7}|:)|fe80:(:[0-9a-fA-F]{0,4}){0,4}%[0-9a-zA-Z]+|::(ffff(:0{1,4})?:)?((25[0-5]|(2[0-4]|1?[0-9])?[0-9])\.){3}(25[0-5]|(2[0-4]|1?[0-9])?[0-9])|([0-9a-fA-F]{1,4}:){1,4}:((25[0-5]|(2[0-4]|1?[0-9])?[0-9])\.){3}(25[0-5]|(2[0-4]|1?[0-9])?[0-9]))(\/([0-9]|[1-9][0-9]|1[0-1][0-9]|12[0-8]))$/;

export default function NetworkingPage() {
    const t = useTranslations();
    const { env } = useEnvContext();
    const api = createApiClient({ env });
    const { orgId } = useParams<{
        orgId: string;
        remoteExitNodeId: string;
    }>();
    const { remoteExitNode } = useRemoteExitNodeContext();

    // Subnets state
    const [subnets, setSubnets] = useState<Tag[]>([]);
    const [activeTagIndex, setActiveTagIndex] = useState<number | null>(null);
    const [loadingSubnets, setLoadingSubnets] = useState(true);

    // Labels state
    const [selectedLabels, setSelectedLabels] = useState<TagValue[]>([]);
    const [labelSearchQuery, setLabelSearchQuery] = useState("");
    const [loadingLabels, setLoadingLabels] = useState(true);

    const [saving, setSaving] = useState(false);

    const [debouncedLabelQuery] = useDebounce(labelSearchQuery, 150);

    const { data: availableLabels = [] } = useQuery(
        orgQueries.labels({ orgId, query: debouncedLabelQuery, perPage: 10 })
    );

    const labelsShown = useMemo<TagValue[]>(() => {
        const base: TagValue[] = availableLabels.map((l) => ({
            id: l.labelId.toString(),
            text: l.name,
            color: l.color
        }));
        if (debouncedLabelQuery.trim().length === 0) {
            for (const sel of selectedLabels) {
                if (!base.find((b) => b.id === sel.id)) {
                    base.unshift(sel);
                }
            }
        }
        return base;
    }, [availableLabels, selectedLabels, debouncedLabelQuery]);

    useEffect(() => {
        async function loadSubnets() {
            try {
                const res = await api.get<
                    AxiosResponse<ListRemoteExitNodeResourcesResponse>
                >(
                    `/org/${orgId}/remote-exit-node/${remoteExitNode.remoteExitNodeId}/resources`
                );
                setSubnets(
                    res.data.data.resources.map((r) => ({
                        id: r.destination,
                        text: r.destination
                    }))
                );
            } catch (error) {
                toast({
                    variant: "destructive",
                    title: t("error"),
                    description:
                        formatAxiosError(error) ||
                        t("remoteExitNodeNetworkingSubnetsLoadError")
                });
            } finally {
                setLoadingSubnets(false);
            }
        }

        async function loadLabels() {
            try {
                const res = await api.get<
                    AxiosResponse<ListRemoteExitNodePreferenceLabelsResponse>
                >(
                    `/org/${orgId}/remote-exit-node/${remoteExitNode.remoteExitNodeId}/preference-labels`
                );
                setSelectedLabels(
                    res.data.data.labels.map((l) => ({
                        id: l.labelId.toString(),
                        text: l.name,
                        color: l.color
                    }))
                );
            } catch (error) {
                toast({
                    variant: "destructive",
                    title: t("error"),
                    description:
                        formatAxiosError(error) ||
                        t("remoteExitNodeNetworkingLabelsLoadError")
                });
            } finally {
                setLoadingLabels(false);
            }
        }

        loadSubnets();
        loadLabels();
    }, [remoteExitNode.remoteExitNodeId]);

    const handleSave = async () => {
        setSaving(true);
        try {
            await Promise.all([
                api.post<AxiosResponse<SetRemoteExitNodeResourcesResponse>>(
                    `/org/${orgId}/remote-exit-node/${remoteExitNode.remoteExitNodeId}/resources`,
                    { destinations: subnets.map((s) => s.text) }
                ),
                api.post<
                    AxiosResponse<SetRemoteExitNodePreferenceLabelsResponse>
                >(
                    `/org/${orgId}/remote-exit-node/${remoteExitNode.remoteExitNodeId}/preference-labels`,
                    { labelIds: selectedLabels.map((l) => parseInt(l.id)) }
                )
            ]);
            toast({
                title: t("remoteExitNodeNetworkingSaveSuccessTitle"),
                description: t("remoteExitNodeNetworkingSaveSuccessDescription")
            });
        } catch (error) {
            toast({
                variant: "destructive",
                title: t("error"),
                description:
                    formatAxiosError(error) ||
                    t("remoteExitNodeNetworkingSaveError")
            });
        } finally {
            setSaving(false);
        }
    };

    return (
        <SettingsContainer>
            <SettingsSection>
                <SettingsSectionHeader>
                    <SettingsSectionTitle>
                        {t("remoteExitNodeNetworkingTitle")}
                    </SettingsSectionTitle>
                    <SettingsSectionDescription>
                        {t("remoteExitNodeNetworkingDescription")}
                        <a
                            href="https://docs.pangolin.net/placeholder"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-primary hover:underline inline-flex items-center gap-1"
                        >
                            {t("learnMore")}
                            <ExternalLink className="size-3.5 shrink-0" />
                        </a>
                    </SettingsSectionDescription>
                </SettingsSectionHeader>
                <SettingsSectionBody>
                    <SettingsSectionForm variant="half">
                        <SettingsFormGrid>
                            <SettingsFormCell span="half">
                                <div className="grid gap-2">
                                    <Label>
                                        {t(
                                            "remoteExitNodeNetworkingSubnetsTitle"
                                        )}
                                    </Label>
                                    <TagInput
                                        tags={subnets}
                                        setTags={setSubnets}
                                        placeholder={t(
                                            "remoteExitNodeNetworkingSubnetsPlaceholder"
                                        )}
                                        validateTag={(tag) =>
                                            cidrRegex.test(tag.trim())
                                        }
                                        activeTagIndex={activeTagIndex}
                                        setActiveTagIndex={setActiveTagIndex}
                                        disabled={loadingSubnets}
                                        allowDuplicates={false}
                                        size="sm"
                                        inlineTags={true}
                                    />
                                    <p className="text-sm text-muted-foreground">
                                        {t.rich(
                                            "remoteExitNodeNetworkingSubnetsDescription",
                                            {
                                                code: (chunks) => (
                                                    <code>{chunks}</code>
                                                )
                                            }
                                        )}{" "}
                                    </p>
                                </div>
                            </SettingsFormCell>
                            <SettingsFormCell span="half">
                                <div className="grid gap-2">
                                    <Label>
                                        {t(
                                            "remoteExitNodeNetworkingLabelsTitle"
                                        )}
                                    </Label>
                                    <MultiSelectTagInput
                                        value={selectedLabels}
                                        options={labelsShown}
                                        onChange={setSelectedLabels}
                                        onSearch={setLabelSearchQuery}
                                        searchQuery={labelSearchQuery}
                                        disabled={loadingLabels}
                                        buttonText={t(
                                            "remoteExitNodeNetworkingLabelsButtonText"
                                        )}
                                        searchPlaceholder={t(
                                            "remoteExitNodeNetworkingLabelsSearchPlaceholder"
                                        )}
                                    />
                                    <p className="text-sm text-muted-foreground">
                                        {t(
                                            "remoteExitNodeNetworkingLabelsDescription"
                                        )}
                                    </p>
                                </div>
                            </SettingsFormCell>
                        </SettingsFormGrid>
                    </SettingsSectionForm>
                </SettingsSectionBody>
                <SettingsSectionFooter>
                    <Button onClick={handleSave} loading={saving}>
                        {t("remoteExitNodeNetworkingSave")}
                    </Button>
                </SettingsSectionFooter>
            </SettingsSection>
        </SettingsContainer>
    );
}
