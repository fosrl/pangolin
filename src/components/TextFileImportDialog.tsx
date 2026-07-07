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
    OptionSelect,
    type OptionSelectOption
} from "@app/components/OptionSelect";
import { Button } from "@app/components/ui/button";
import { CheckboxWithLabel } from "@app/components/ui/checkbox";
import { Textarea } from "@app/components/ui/textarea";
import {
    applyTextImport,
    parsePreviewLines,
    parseTextFileItems,
    type TextImportFileType,
    type TextImportMode
} from "@app/lib/roleFormTextImport";
import { useTranslations } from "next-intl";
import { useEffect, useMemo, useState } from "react";

type TextFileImportDialogProps = {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    fileName: string;
    fileType: TextImportFileType;
    rawContent: string;
    currentValue: string;
    fieldLabel: string;
    parser: (value: string | undefined) => string[];
    onConfirm: (value: string) => void;
};

export function TextFileImportDialog({
    open,
    onOpenChange,
    fileName,
    fileType,
    rawContent,
    currentValue,
    fieldLabel,
    parser,
    onConfirm
}: TextFileImportDialogProps) {
    const t = useTranslations();
    const [editablePreview, setEditablePreview] = useState("");
    const [skipHeader, setSkipHeader] = useState(false);
    const [mode, setMode] = useState<TextImportMode>("override");

    const parsedFromFile = useMemo(
        () =>
            parseTextFileItems({
                content: rawContent,
                fileType,
                skipHeader,
                parser
            }),
        [rawContent, fileType, skipHeader, parser]
    );

    useEffect(() => {
        setEditablePreview(parsedFromFile.join("\n"));
    }, [parsedFromFile]);

    const importedItems = useMemo(
        () => parsePreviewLines(editablePreview),
        [editablePreview]
    );

    const existingCount = useMemo(
        () => parser(currentValue).length,
        [currentValue, parser]
    );

    const totalCount =
        mode === "append"
            ? existingCount + importedItems.length
            : importedItems.length;

    const modeOptions: OptionSelectOption<TextImportMode>[] = [
        {
            value: "override",
            label: t("roleTextImportOverride")
        },
        {
            value: "append",
            label: t("roleTextImportAppend")
        }
    ];

    function handleConfirm() {
        onConfirm(
            applyTextImport({
                currentValue,
                imported: importedItems,
                mode,
                parser
            })
        );
        onOpenChange(false);
    }

    return (
        <Credenza open={open} onOpenChange={onOpenChange}>
            <CredenzaContent>
                <CredenzaHeader>
                    <CredenzaTitle>{t("roleTextImportTitle")}</CredenzaTitle>
                    <CredenzaDescription>
                        {t("roleTextImportDescription", {
                            fileName,
                            fieldLabel
                        })}
                    </CredenzaDescription>
                </CredenzaHeader>

                <CredenzaBody>
                    {fileType === "csv" && (
                        <CheckboxWithLabel
                            checked={skipHeader}
                            onCheckedChange={(checked) => {
                                if (checked !== "indeterminate") {
                                    setSkipHeader(checked);
                                }
                            }}
                            label={t("roleTextImportSkipHeader")}
                        />
                    )}

                    <div className="space-y-2">
                        <p className="text-sm font-medium">
                            {t("roleTextImportPreview")}
                        </p>
                        <Textarea
                            value={editablePreview}
                            onChange={(event) =>
                                setEditablePreview(event.target.value)
                            }
                            placeholder={t("roleTextImportEmpty")}
                            className="min-h-32 text-sm"
                        />
                    </div>

                    <OptionSelect<TextImportMode>
                        label={t("roleTextImportMode")}
                        options={modeOptions}
                        value={mode}
                        onChange={setMode}
                        cols={2}
                    />

                    <p className="text-sm text-muted-foreground">
                        {mode === "append"
                            ? t("roleTextImportTotalCount", {
                                  existing: existingCount,
                                  imported: importedItems.length,
                                  total: totalCount
                              })
                            : t("roleTextImportItemCount", {
                                  count: importedItems.length
                              })}
                    </p>
                </CredenzaBody>

                <CredenzaFooter>
                    <CredenzaClose asChild>
                        <Button type="button" variant="outline">
                            {t("close")}
                        </Button>
                    </CredenzaClose>
                    <Button
                        type="button"
                        onClick={handleConfirm}
                        disabled={importedItems.length === 0}
                    >
                        {t("roleTextImportConfirm")}
                    </Button>
                </CredenzaFooter>
            </CredenzaContent>
        </Credenza>
    );
}
