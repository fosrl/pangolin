"use client";

import { useEffect, useState } from "react";
import { Checkbox } from "@app/components/ui/checkbox";
import { FormLabel } from "@app/components/ui/form";
import { TagInput, type Tag } from "@app/components/tags/tag-input";
import { useTranslations } from "next-intl";

type VirtualApiKeyEmailSectionProps = {
    emailEnabled: boolean;
    mode: "create" | "edit";
    sendEmail: boolean;
    onSendEmailChange: (value: boolean) => void;
    sendToAttributedUser: boolean;
    onSendToAttributedUserChange: (value: boolean) => void;
    hasAssociatedUser: boolean;
    emailTags: Tag[];
    onEmailTagsChange: (tags: Tag[]) => void;
};

export default function VirtualApiKeyEmailSection({
    emailEnabled,
    mode,
    sendEmail,
    onSendEmailChange,
    sendToAttributedUser,
    onSendToAttributedUserChange,
    hasAssociatedUser,
    emailTags,
    onEmailTagsChange
}: VirtualApiKeyEmailSectionProps) {
    const t = useTranslations();
    const [activeEmailTagIndex, setActiveEmailTagIndex] = useState<
        number | null
    >(null);

    useEffect(() => {
        if (!hasAssociatedUser && sendToAttributedUser) {
            onSendToAttributedUserChange(false);
        }
    }, [hasAssociatedUser, sendToAttributedUser, onSendToAttributedUserChange]);

    const checkboxId =
        mode === "create"
            ? "virtual-api-key-send-email"
            : "edit-virtual-api-key-send-email";
    const sendToUserId =
        mode === "create"
            ? "virtual-api-key-send-to-user"
            : "edit-virtual-api-key-send-to-user";

    return (
        <div className="space-y-3">
            <div className="flex items-start space-x-2">
                <Checkbox
                    id={checkboxId}
                    checked={emailEnabled ? sendEmail : false}
                    disabled={!emailEnabled}
                    onCheckedChange={(val) => {
                        if (emailEnabled) {
                            onSendEmailChange(val === true);
                        }
                    }}
                    className="mt-0.5"
                />
                <div className="space-y-1">
                    <label
                        htmlFor={checkboxId}
                        className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
                    >
                        {t(
                            mode === "create"
                                ? "virtualApiKeysEmailOnGenerate"
                                : "virtualApiKeysEmailThisKey"
                        )}
                    </label>
                    <p className="text-sm text-muted-foreground">
                        {emailEnabled
                            ? t(
                                  mode === "create"
                                      ? "virtualApiKeysEmailOnGenerateDescription"
                                      : "virtualApiKeysEmailThisKeyDescription"
                              )
                            : t("virtualApiKeysEmailSmtpRequiredDescription")}
                    </p>
                </div>
            </div>

            {emailEnabled && sendEmail && (
                <div className="space-y-4 pl-6">
                    <div className="flex items-start space-x-2">
                        <Checkbox
                            id={sendToUserId}
                            checked={sendToAttributedUser}
                            disabled={!hasAssociatedUser}
                            onCheckedChange={(val) =>
                                onSendToAttributedUserChange(val === true)
                            }
                            className="mt-0.5"
                        />
                        <div className="space-y-1">
                            <label
                                htmlFor={sendToUserId}
                                className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
                            >
                                {t("virtualApiKeysEmailSendToUser")}
                            </label>
                            <p className="text-sm text-muted-foreground">
                                {hasAssociatedUser
                                    ? t(
                                          "virtualApiKeysEmailSendToUserDescription"
                                      )
                                    : t(
                                          "virtualApiKeysEmailSendToUserDisabled"
                                      )}
                            </p>
                        </div>
                    </div>

                    <div className="space-y-2">
                        <FormLabel>
                            {t("virtualApiKeysEmailAdditional")}
                        </FormLabel>
                        <TagInput
                            activeTagIndex={activeEmailTagIndex}
                            setActiveTagIndex={setActiveEmailTagIndex}
                            placeholder={t(
                                "virtualApiKeysEmailAdditionalPlaceholder"
                            )}
                            size="sm"
                            tags={emailTags}
                            setTags={(newTags) => {
                                const next =
                                    typeof newTags === "function"
                                        ? newTags(emailTags)
                                        : newTags;
                                onEmailTagsChange(next as Tag[]);
                            }}
                            allowDuplicates={false}
                            sortTags
                            validateTag={(tag) =>
                                /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(tag)
                            }
                            delimiterList={[",", "Enter"]}
                        />
                    </div>
                </div>
            )}
        </div>
    );
}
