"use client";

import {
    TIMESTAMP_PLACEHOLDER,
    TimestampInText
} from "@app/components/Timestamp";
import { useState, useEffect } from "react";
import { useTranslations } from "next-intl";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { createApiClient } from "@app/lib/api";
import { formatAxiosError } from "@app/lib/api";
import { toast } from "@app/hooks/useToast";
import { Button } from "@app/components/ui/button";
import {
    Form,
    FormControl,
    FormField,
    FormItem,
    FormLabel,
    FormMessage
} from "@app/components/ui/form";
import { Input } from "@app/components/ui/input";
import { Alert, AlertDescription } from "@app/components/ui/alert";
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
import { startRegistration } from "@simplewebauthn/browser";
import { useEnvContext } from "@app/hooks/useEnvContext";
import { Card, CardContent } from "@app/components/ui/card";
import { Badge } from "@app/components/ui/badge";
import { Loader2, KeyRound, Trash2, Plus, Shield, Info } from "lucide-react";
import { cn } from "@app/lib/cn";

type SecurityKeyFormProps = {
    open: boolean;
    setOpen: (open: boolean) => void;
};

type SecurityKey = {
    credentialId: string;
    name: string;
    lastUsed: string;
};

type DeleteSecurityKeyData = {
    credentialId: string;
    name: string;
};

type RegisterFormValues = {
    name: string;
    password: string;
    code?: string;
};

type DeleteFormValues = {
    password: string;
    code?: string;
};

type FieldProps = {
    field: {
        value: string;
        onChange: (event: React.ChangeEvent<HTMLInputElement>) => void;
        onBlur: () => void;
        name: string;
        ref: React.Ref<HTMLInputElement>;
    };
};

export default function SecurityKeyForm({
    open,
    setOpen
}: SecurityKeyFormProps) {
    const t = useTranslations();
    const { env } = useEnvContext();
    const api = createApiClient({ env });
    const [securityKeys, setSecurityKeys] = useState<SecurityKey[]>([]);
    const [isRegistering, setIsRegistering] = useState(false);
    const [dialogState, setDialogState] = useState<
        "list" | "register" | "register2fa" | "delete" | "delete2fa"
    >("list");
    const [selectedSecurityKey, setSelectedSecurityKey] =
        useState<DeleteSecurityKeyData | null>(null);
    const [deleteInProgress, setDeleteInProgress] = useState(false);
    const [pendingDeleteCredentialId, setPendingDeleteCredentialId] = useState<
        string | null
    >(null);
    const [pendingDeletePassword, setPendingDeletePassword] = useState<
        string | null
    >(null);
    const [pendingRegisterData, setPendingRegisterData] = useState<{
        name: string;
        password: string;
    } | null>(null);
    const [register2FAForm, setRegister2FAForm] = useState<{ code: string }>({
        code: ""
    });

    useEffect(() => {
        if (open) {
            loadSecurityKeys();
        }
    }, [open]);

    const registerSchema = z.object({
        name: z.string().min(1, { message: t("securityKeyNameRequired") }),
        password: z.string().min(1, { message: t("passwordRequired") }),
        code: z.string().optional()
    });

    const deleteSchema = z.object({
        password: z.string().min(1, { message: t("passwordRequired") }),
        code: z.string().optional()
    });

    const registerForm = useForm({
        resolver: zodResolver(registerSchema),
        defaultValues: {
            name: "",
            password: "",
            code: ""
        }
    });

    const deleteForm = useForm({
        resolver: zodResolver(deleteSchema),
        defaultValues: {
            password: "",
            code: ""
        }
    });

    const loadSecurityKeys = async () => {
        try {
            const response = await api.get("/auth/security-key/list");
            setSecurityKeys(response.data.data);
        } catch (error) {
            toast({
                variant: "destructive",
                description: formatAxiosError(error, t("securityKeyLoadError"))
            });
        }
    };

    const handleRegisterSecurityKey = async (values: RegisterFormValues) => {
        try {
            // Check browser compatibility first
            if (!window.PublicKeyCredential) {
                toast({
                    variant: "destructive",
                    description: t("securityKeyBrowserNotSupported", {
                        defaultValue:
                            "Your browser doesn't support security keys. Please use a modern browser like Chrome, Firefox, or Safari."
                    })
                });
                return;
            }

            setIsRegistering(true);
            const startRes = await api.post(
                "/auth/security-key/register/start",
                {
                    name: values.name,
                    password: values.password,
                    code: values.code
                }
            );

            // If 2FA is required
            if (startRes.status === 202 && startRes.data.data?.codeRequested) {
                setPendingRegisterData({
                    name: values.name,
                    password: values.password
                });
                setDialogState("register2fa");
                setIsRegistering(false);
                return;
            }

            const options = startRes.data.data;

            try {
                const credential = await startRegistration(options);

                await api.post("/auth/security-key/register/verify", {
                    credential
                });

                toast({
                    description: t("securityKeyRegisterSuccess", {
                        defaultValue: "Security key registered successfully"
                    })
                });

                registerForm.reset();
                setDialogState("list");
                await loadSecurityKeys();
            } catch (error: any) {
                if (error.name === "NotAllowedError") {
                    if (error.message.includes("denied permission")) {
                        toast({
                            variant: "destructive",
                            description: t("securityKeyPermissionDenied", {
                                defaultValue:
                                    "Please allow access to your security key to continue registration."
                            })
                        });
                    } else {
                        toast({
                            variant: "destructive",
                            description: t("securityKeyRemovedTooQuickly", {
                                defaultValue:
                                    "Please keep your security key connected until the registration process completes."
                            })
                        });
                    }
                } else if (error.name === "NotSupportedError") {
                    toast({
                        variant: "destructive",
                        description: t("securityKeyNotSupported", {
                            defaultValue:
                                "Your security key may not be compatible. Please try a different security key."
                        })
                    });
                } else {
                    toast({
                        variant: "destructive",
                        description: t("securityKeyUnknownError", {
                            defaultValue:
                                "There was a problem registering your security key. Please try again."
                        })
                    });
                }
                throw error; // Re-throw to be caught by outer catch
            }
        } catch (error) {
            console.error("Security key registration error:", error);
            toast({
                variant: "destructive",
                description: formatAxiosError(
                    error,
                    t("securityKeyRegisterError", {
                        defaultValue: "Failed to register security key"
                    })
                )
            });
        } finally {
            setIsRegistering(false);
        }
    };

    const handleDeleteSecurityKey = async (values: DeleteFormValues) => {
        if (!selectedSecurityKey) return;

        try {
            setDeleteInProgress(true);
            const encodedCredentialId = encodeURIComponent(
                selectedSecurityKey.credentialId
            );
            const response = await api.delete(
                `/auth/security-key/${encodedCredentialId}`,
                {
                    data: {
                        password: values.password,
                        code: values.code
                    }
                }
            );

            // If 2FA is required
            if (response.status === 202 && response.data.data.codeRequested) {
                setPendingDeleteCredentialId(encodedCredentialId);
                setPendingDeletePassword(values.password);
                setDialogState("delete2fa");
                return;
            }

            toast({
                description: t("securityKeyRemoveSuccess")
            });

            deleteForm.reset();
            setSelectedSecurityKey(null);
            setDialogState("list");
            await loadSecurityKeys();
        } catch (error) {
            toast({
                variant: "destructive",
                description: formatAxiosError(
                    error,
                    t("securityKeyRemoveError")
                )
            });
        } finally {
            setDeleteInProgress(false);
        }
    };

    const handle2FASubmit = async (values: DeleteFormValues) => {
        if (!pendingDeleteCredentialId || !pendingDeletePassword) return;

        try {
            setDeleteInProgress(true);
            await api.delete(
                `/auth/security-key/${pendingDeleteCredentialId}`,
                {
                    data: {
                        password: pendingDeletePassword,
                        code: values.code
                    }
                }
            );

            toast({
                description: t("securityKeyRemoveSuccess")
            });

            deleteForm.reset();
            setSelectedSecurityKey(null);
            setDialogState("list");
            setPendingDeleteCredentialId(null);
            setPendingDeletePassword(null);
            await loadSecurityKeys();
        } catch (error) {
            toast({
                variant: "destructive",
                description: formatAxiosError(
                    error,
                    t("securityKeyRemoveError")
                )
            });
        } finally {
            setDeleteInProgress(false);
        }
    };

    const handleRegister2FASubmit = async (values: { code: string }) => {
        if (!pendingRegisterData) return;

        try {
            setIsRegistering(true);
            const startRes = await api.post(
                "/auth/security-key/register/start",
                {
                    name: pendingRegisterData.name,
                    password: pendingRegisterData.password,
                    code: values.code
                }
            );

            const options = startRes.data.data;

            try {
                const credential = await startRegistration(options);

                await api.post("/auth/security-key/register/verify", {
                    credential
                });

                toast({
                    description: t("securityKeyRegisterSuccess", {
                        defaultValue: "Security key registered successfully"
                    })
                });

                registerForm.reset();
                setDialogState("list");
                setPendingRegisterData(null);
                setRegister2FAForm({ code: "" });
                await loadSecurityKeys();
            } catch (error: any) {
                if (error.name === "NotAllowedError") {
                    if (error.message.includes("denied permission")) {
                        toast({
                            variant: "destructive",
                            description: t("securityKeyPermissionDenied", {
                                defaultValue:
                                    "Please allow access to your security key to continue registration."
                            })
                        });
                    } else {
                        toast({
                            variant: "destructive",
                            description: t("securityKeyRemovedTooQuickly", {
                                defaultValue:
                                    "Please keep your security key connected until the registration process completes."
                            })
                        });
                    }
                } else if (error.name === "NotSupportedError") {
                    toast({
                        variant: "destructive",
                        description: t("securityKeyNotSupported", {
                            defaultValue:
                                "Your security key may not be compatible. Please try a different security key."
                        })
                    });
                } else {
                    toast({
                        variant: "destructive",
                        description: t("securityKeyUnknownError", {
                            defaultValue:
                                "There was a problem registering your security key. Please try again."
                        })
                    });
                }
                throw error; // Re-throw to be caught by outer catch
            }
        } catch (error) {
            console.error("Security key registration error:", error);
            toast({
                variant: "destructive",
                description: formatAxiosError(
                    error,
                    t("securityKeyRegisterError", {
                        defaultValue: "Failed to register security key"
                    })
                )
            });
            setRegister2FAForm({ code: "" });
        } finally {
            setIsRegistering(false);
        }
    };

    const onOpenChange = (open: boolean) => {
        if (open) {
            loadSecurityKeys();
        } else {
            registerForm.reset();
            deleteForm.reset();
            setSelectedSecurityKey(null);
            setDialogState("list");
            setPendingRegisterData(null);
            setRegister2FAForm({ code: "" });
        }
        setOpen(open);
    };

    return (
        <>
            <Credenza open={open} onOpenChange={onOpenChange}>
                <CredenzaContent>
                    {dialogState === "list" && (
                        <>
                            <CredenzaHeader>
                                <CredenzaTitle className="flex items-center gap-2">
                                    {t("securityKeyManage")}
                                </CredenzaTitle>
                                <CredenzaDescription>
                                    {t("securityKeyDescription")}
                                </CredenzaDescription>
                            </CredenzaHeader>
                            <CredenzaBody>
                                <div className="space-y-4">
                                    <div className="flex items-center justify-between">
                                        <h3 className="text-sm font-medium text-muted-foreground">
                                            {t("securityKeyList")}
                                        </h3>
                                        <Button
                                            onClick={() =>
                                                setDialogState("register")
                                            }
                                            className="gap-2"
                                        >
                                            <Plus className="h-4 w-4" />
                                            {t("securityKeyAdd")}
                                        </Button>
                                    </div>

                                    {securityKeys.length > 0 ? (
                                        <div className="space-y-2">
                                            {securityKeys.map((securityKey) => (
                                                <Card
                                                    key={
                                                        securityKey.credentialId
                                                    }
                                                >
                                                    <CardContent className="flex items-center justify-between p-4">
                                                        <div className="flex items-center gap-3">
                                                            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-secondary">
                                                                <KeyRound className="h-4 w-4 text-secondary-foreground" />
                                                            </div>
                                                            <div>
                                                                <p className="font-medium">
                                                                    {
                                                                        securityKey.name
                                                                    }
                                                                </p>
                                                                <p className="text-xs text-muted-foreground">
                                                                    <TimestampInText
                                                                        text={t(
                                                                            "securityKeyLastUsed",
                                                                            {
                                                                                date: TIMESTAMP_PLACEHOLDER
                                                                            }
                                                                        )}
                                                                        value={
                                                                            securityKey.lastUsed
                                                                        }
                                                                    />
                                                                </p>
                                                            </div>
                                                        </div>
                                                        <Button
                                                            className="h-8 w-8 p-0 text-white hover:text-white/80"
                                                            onClick={() => {
                                                                setSelectedSecurityKey(
                                                                    {
                                                                        credentialId:
                                                                            securityKey.credentialId,
                                                                        name: securityKey.name
                                                                    }
                                                                );
                                                                setDialogState(
                                                                    "delete"
                                                                );
                                                            }}
                                                        >
                                                            <Trash2 className="h-4 w-4" />
                                                        </Button>
                                                    </CardContent>
                                                </Card>
                                            ))}
                                        </div>
                                    ) : (
                                        <div className="flex flex-col items-center justify-center py-8 text-center">
                                            <Shield className="mb-2 h-12 w-12 text-muted-foreground" />
                                            <p className="text-sm text-muted-foreground">
                                                {t(
                                                    "securityKeyNoKeysRegistered"
                                                )}
                                            </p>
                                            <p className="text-xs text-muted-foreground">
                                                {t(
                                                    "securityKeyNoKeysDescription"
                                                )}
                                            </p>
                                        </div>
                                    )}

                                    {securityKeys.length === 1 && (
                                        <Alert variant="default">
                                            <Info className="h-4 w-4" />
                                            <AlertDescription>
                                                {t("securityKeyRecommendation")}
                                            </AlertDescription>
                                        </Alert>
                                    )}
                                </div>
                            </CredenzaBody>
                        </>
                    )}

                    {dialogState === "register" && (
                        <>
                            <CredenzaHeader>
                                <CredenzaTitle>
                                    {t("securityKeyRegisterTitle")}
                                </CredenzaTitle>
                                <CredenzaDescription>
                                    {t("securityKeyRegisterDescription")}
                                </CredenzaDescription>
                            </CredenzaHeader>
                            <CredenzaBody>
                                <Form {...registerForm}>
                                    <form
                                        onSubmit={registerForm.handleSubmit(
                                            handleRegisterSecurityKey
                                        )}
                                        className="space-y-4"
                                        id="form"
                                    >
                                        <FormField
                                            control={registerForm.control}
                                            name="name"
                                            render={({ field }: FieldProps) => (
                                                <FormItem>
                                                    <FormLabel>
                                                        {t(
                                                            "securityKeyNameLabel"
                                                        )}
                                                    </FormLabel>
                                                    <FormControl>
                                                        <Input
                                                            {...field}
                                                            disabled={
                                                                isRegistering
                                                            }
                                                        />
                                                    </FormControl>
                                                    <FormMessage />
                                                </FormItem>
                                            )}
                                        />
                                        <FormField
                                            control={registerForm.control}
                                            name="password"
                                            render={({ field }: FieldProps) => (
                                                <FormItem>
                                                    <FormLabel>
                                                        {t("password")}
                                                    </FormLabel>
                                                    <FormControl>
                                                        <Input
                                                            {...field}
                                                            type="password"
                                                            disabled={
                                                                isRegistering
                                                            }
                                                        />
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
                                    <Button
                                        variant="outline"
                                        onClick={() => {
                                            registerForm.reset();
                                            setDialogState("list");
                                        }}
                                        disabled={isRegistering}
                                    >
                                        {t("cancel")}
                                    </Button>
                                </CredenzaClose>
                                <Button
                                    type="submit"
                                    form="form"
                                    disabled={isRegistering}
                                    className={cn(
                                        "min-w-[100px]",
                                        isRegistering &&
                                            "cursor-not-allowed opacity-50"
                                    )}
                                    loading={isRegistering}
                                >
                                    {t("securityKeyRegister")}
                                </Button>
                            </CredenzaFooter>
                        </>
                    )}

                    {dialogState === "register2fa" && (
                        <>
                            <CredenzaHeader>
                                <CredenzaTitle>
                                    {t("securityKeyTwoFactorRequired")}
                                </CredenzaTitle>
                                <CredenzaDescription>
                                    {t("securityKeyTwoFactorDescription")}
                                </CredenzaDescription>
                            </CredenzaHeader>
                            <CredenzaBody>
                                <div className="space-y-4">
                                    <div>
                                        <label className="text-sm font-medium">
                                            {t("securityKeyTwoFactorCode")}
                                        </label>
                                        <Input
                                            type="text"
                                            value={register2FAForm.code}
                                            onChange={(e) =>
                                                setRegister2FAForm({
                                                    code: e.target.value
                                                })
                                            }
                                            maxLength={6}
                                            disabled={isRegistering}
                                        />
                                    </div>
                                </div>
                            </CredenzaBody>
                            <CredenzaFooter>
                                <CredenzaClose asChild>
                                    <Button
                                        variant="outline"
                                        onClick={() => {
                                            setRegister2FAForm({ code: "" });
                                            setDialogState("list");
                                            setPendingRegisterData(null);
                                        }}
                                        disabled={isRegistering}
                                    >
                                        {t("cancel")}
                                    </Button>
                                </CredenzaClose>
                                <Button
                                    type="button"
                                    className="min-w-[100px]"
                                    disabled={
                                        isRegistering ||
                                        register2FAForm.code.length !== 6
                                    }
                                    loading={isRegistering}
                                    onClick={() =>
                                        handleRegister2FASubmit({
                                            code: register2FAForm.code
                                        })
                                    }
                                >
                                    {t("securityKeyRegister")}
                                </Button>
                            </CredenzaFooter>
                        </>
                    )}

                    {dialogState === "delete" && (
                        <>
                            <CredenzaHeader>
                                <CredenzaTitle className="flex items-center gap-2">
                                    {t("securityKeyRemoveTitle")}
                                </CredenzaTitle>
                                <CredenzaDescription>
                                    {t("securityKeyRemoveDescription", {
                                        name: selectedSecurityKey!.name!
                                    })}
                                </CredenzaDescription>
                            </CredenzaHeader>
                            <CredenzaBody>
                                <Form {...deleteForm}>
                                    <form
                                        onSubmit={deleteForm.handleSubmit(
                                            handleDeleteSecurityKey
                                        )}
                                        className="space-y-4"
                                        id="delete-form"
                                    >
                                        <FormField
                                            control={deleteForm.control}
                                            name="password"
                                            render={({ field }) => (
                                                <FormItem>
                                                    <FormLabel>
                                                        {t("password")}
                                                    </FormLabel>
                                                    <FormControl>
                                                        <Input
                                                            {...field}
                                                            type="password"
                                                            disabled={
                                                                deleteInProgress
                                                            }
                                                        />
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
                                    <Button
                                        variant="outline"
                                        onClick={() => {
                                            deleteForm.reset();
                                            setSelectedSecurityKey(null);
                                            setDialogState("list");
                                        }}
                                        disabled={deleteInProgress}
                                    >
                                        {t("cancel")}
                                    </Button>
                                </CredenzaClose>
                                <Button
                                    type="submit"
                                    form="delete-form"
                                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                                    disabled={deleteInProgress}
                                    loading={deleteInProgress}
                                >
                                    {t("securityKeyRemove")}
                                </Button>
                            </CredenzaFooter>
                        </>
                    )}

                    {dialogState === "delete2fa" && (
                        <>
                            <CredenzaHeader>
                                <CredenzaTitle>
                                    {t("securityKeyTwoFactorRequired")}
                                </CredenzaTitle>
                                <CredenzaDescription>
                                    {t("securityKeyTwoFactorRemoveDescription")}
                                </CredenzaDescription>
                            </CredenzaHeader>
                            <CredenzaBody>
                                <Form {...deleteForm}>
                                    <form
                                        onSubmit={deleteForm.handleSubmit(
                                            handle2FASubmit
                                        )}
                                        className="space-y-4"
                                        id="delete2fa-form"
                                    >
                                        <FormField
                                            control={deleteForm.control}
                                            name="code"
                                            render={({ field }) => (
                                                <FormItem>
                                                    <FormLabel>
                                                        {t(
                                                            "securityKeyTwoFactorCode"
                                                        )}
                                                    </FormLabel>
                                                    <FormControl>
                                                        <Input
                                                            {...field}
                                                            type="text"
                                                            maxLength={6}
                                                            disabled={
                                                                deleteInProgress
                                                            }
                                                        />
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
                                    <Button
                                        variant="outline"
                                        onClick={() => {
                                            deleteForm.reset();
                                            setDialogState("list");
                                            setPendingDeleteCredentialId(null);
                                            setPendingDeletePassword(null);
                                        }}
                                        disabled={deleteInProgress}
                                    >
                                        {t("cancel")}
                                    </Button>
                                </CredenzaClose>
                                <Button
                                    type="submit"
                                    form="delete2fa-form"
                                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                                    disabled={deleteInProgress}
                                    loading={deleteInProgress}
                                >
                                    {t("securityKeyRemove")}
                                </Button>
                            </CredenzaFooter>
                        </>
                    )}
                </CredenzaContent>
            </Credenza>
        </>
    );
}
