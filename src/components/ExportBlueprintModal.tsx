"use client";

import { useEffect, useState } from "react";
import Editor from "@monaco-editor/react";
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
import { Button } from "@app/components/ui/button";
import { useEnvContext } from "@app/hooks/useEnvContext";
import { toast } from "@app/hooks/useToast";
import { createApiClient, formatAxiosError } from "@app/lib/api";
import { cn } from "@app/lib/cn";
import { Download, Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";

type ExportBlueprintModalProps = {
    open: boolean;
    setOpen: (open: boolean) => void;
    endpoint: string;
    resourceName: string;
    title?: string;
    description?: string;
};

export default function ExportBlueprintModal({
    open,
    setOpen,
    endpoint,
    resourceName,
    title,
    description
}: ExportBlueprintModalProps) {
    const t = useTranslations();
    const { env } = useEnvContext();
    const api = createApiClient({ env });

    const [loading, setLoading] = useState(false);
    const [contents, setContents] = useState<string | null>(null);
    const [fileName, setFileName] = useState(resourceName);

    useEffect(() => {
        if (!open) {
            return;
        }

        setContents(null);
        setLoading(true);

        api.get(endpoint)
            .then((res) => {
                setContents(res.data.data.contents);
                setFileName(res.data.data.name || resourceName);
            })
            .catch((e) => {
                toast({
                    variant: "destructive",
                    title: t("exportBlueprintError"),
                    description: formatAxiosError(e, t("exportBlueprintError"))
                });
                setOpen(false);
            })
            .finally(() => setLoading(false));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open, endpoint]);

    function handleDownload() {
        if (!contents) {
            return;
        }

        const blob = new Blob([contents], { type: "application/x-yaml" });
        const url = window.URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.setAttribute("download", `${fileName}.yaml`);
        document.body.appendChild(link);
        link.click();
        link.parentNode?.removeChild(link);
        window.URL.revokeObjectURL(url);
    }

    return (
        <Credenza open={open} onOpenChange={setOpen}>
            <CredenzaContent>
                <CredenzaHeader>
                    <CredenzaTitle>
                        {title ?? t("exportBlueprintTitle")}
                    </CredenzaTitle>
                    <CredenzaDescription>
                        {description ??
                            t("exportBlueprintDescription", {
                                name: resourceName
                            })}
                    </CredenzaDescription>
                </CredenzaHeader>
                <CredenzaBody>
                    <div
                        className={cn(
                            "resize-y h-64 min-h-64 overflow-y-auto overflow-x-clip max-w-full rounded-md border"
                        )}
                    >
                        {loading ? (
                            <div className="flex items-center justify-center w-full h-full">
                                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                            </div>
                        ) : (
                            <Editor
                                className="w-full h-full max-w-full"
                                language="yaml"
                                theme="vs-dark"
                                value={contents ?? ""}
                                options={{
                                    minimap: { enabled: false },
                                    readOnly: true
                                }}
                            />
                        )}
                    </div>
                </CredenzaBody>
                <CredenzaFooter>
                    <CredenzaClose asChild>
                        <Button variant="outline">{t("close")}</Button>
                    </CredenzaClose>
                    <Button
                        onClick={handleDownload}
                        disabled={!contents || loading}
                    >
                        <Download className="mr-2 h-4 w-4" />
                        {t("download")}
                    </Button>
                </CredenzaFooter>
            </CredenzaContent>
        </Credenza>
    );
}
