"use client";

import { useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import * as z from "zod";
import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle
} from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
    Form,
    FormControl,
    FormDescription,
    FormField,
    FormItem,
    FormLabel,
    FormMessage
} from "@/components/ui/form";
import { LockIcon, Binary, Key, User, Send, AtSign } from "lucide-react";
import {
    InputOTP,
    InputOTPGroup,
    InputOTPSlot
} from "@app/components/ui/input-otp";
import { useRouter } from "next/navigation";
import { Alert, AlertDescription } from "@app/components/ui/alert";
import LoginForm, { LoginFormIDP } from "@app/components/LoginForm";
import ResourceAccessDenied from "@app/components/ResourceAccessDenied";
import {
    resourcePasswordProxy,
    resourcePincodeProxy,
    resourceWhitelistProxy,
    resourceAccessProxy
} from "@app/actions/server";
import { useEnvContext } from "@app/hooks/useEnvContext";
import { toast } from "@app/hooks/useToast";
import Link from "next/link";
import BrandingLogo from "@app/components/BrandingLogo";
import { useSupporterStatusContext } from "@app/hooks/useSupporterStatusContext";
import { useTranslations } from "next-intl";
import { build } from "@server/build";
import { useLicenseStatusContext } from "@app/hooks/useLicenseStatusContext";
import { replacePlaceholder } from "@app/lib/replacePlaceholder";

const pinSchema = z.object({
    pin: z
        .string()
        .length(6, { message: "PIN must be exactly 6 digits" })
        .regex(/^\d+$/, { message: "PIN must only contain numbers" })
});

const passwordSchema = z.object({
    password: z.string().min(1, {
        message: "Password must be at least 1 character long"
    })
});

const requestOtpSchema = z.object({
    email: z.string().email()
});

const submitOtpSchema = z.object({
    email: z.string().email(),
    otp: z.string().min(1, {
        message: "OTP must be at least 1 character long"
    })
});

type ResourceAuthPortalProps = {
    methods: {
        password: boolean;
        pincode: boolean;
        sso: boolean;
        whitelist: boolean;
    };
    resource: {
        name: string;
        id: number;
    };
    redirect: string;
    idps?: LoginFormIDP[];
    orgId?: string;
    branding?: {
        logoUrl: string;
        logoWidth: number;
        logoHeight: number;
        primaryColor: string | null;
        resourceTitle: string;
        resourceSubtitle: string | null;
    };
};

export default function ResourceAuthPortal(props: ResourceAuthPortalProps) {
    const router = useRouter();
    const t = useTranslations();
    const { isUnlocked, licenseStatus } = useLicenseStatusContext();

    const getNumMethods = () => {
        let colLength = 0;
        if (props.methods.pincode) colLength++;
        if (props.methods.password) colLength++;
        if (props.methods.sso) colLength++;
        if (props.methods.whitelist) colLength++;
        return colLength;
    };

    const [numMethods] = useState(() => getNumMethods());

    const [passwordError, setPasswordError] = useState<string | null>(null);
    const [pincodeError, setPincodeError] = useState<string | null>(null);
    const [whitelistError, setWhitelistError] = useState<string | null>(null);
    const [accessDenied, setAccessDenied] = useState<boolean>(false);
    const [loadingLogin, setLoadingLogin] = useState(false);

    const [otpState, setOtpState] = useState<"idle" | "otp_sent">("idle");

    const { env } = useEnvContext();

    const { supporterStatus } = useSupporterStatusContext();

    function getDefaultSelectedMethod() {
        if (props.methods.sso) {
            return "sso";
        }

        if (props.methods.password) {
            return "password";
        }

        if (props.methods.pincode) {
            return "pin";
        }

        if (props.methods.whitelist) {
            return "whitelist";
        }
    }

    const [activeTab, setActiveTab] = useState(getDefaultSelectedMethod());

    const pinForm = useForm({
        resolver: zodResolver(pinSchema),
        defaultValues: {
            pin: ""
        }
    });

    const passwordForm = useForm({
        resolver: zodResolver(passwordSchema),
        defaultValues: {
            password: ""
        }
    });

    const requestOtpForm = useForm({
        resolver: zodResolver(requestOtpSchema),
        defaultValues: {
            email: ""
        }
    });

    const submitOtpForm = useForm({
        resolver: zodResolver(submitOtpSchema),
        defaultValues: {
            email: "",
            otp: ""
        }
    });

    function appendRequestToken(url: string, token: string) {
        const fullUrl = new URL(url);
        fullUrl.searchParams.append(
            env.server.resourceSessionRequestParam,
            token
        );
        return fullUrl.toString();
    }

    const onWhitelistSubmit = async (values: any) => {
        setLoadingLogin(true);
        setWhitelistError(null);

        try {
            const response = await resourceWhitelistProxy(props.resource.id, {
                email: values.email,
                otp: values.otp
            });

            if (response.error) {
                setWhitelistError(response.message);
                return;
            }

            const data = response.data!;
            if (data.otpSent) {
                setOtpState("otp_sent");
                submitOtpForm.setValue("email", values.email);
                toast({
                    title: t("otpEmailSent"),
                    description: t("otpEmailSentDescription")
                });
                return;
            }

            const session = data.session;
            if (session) {
                window.location.href = appendRequestToken(
                    props.redirect,
                    session
                );
            }
        } catch (e: any) {
            console.error(e);
            setWhitelistError(
                t("otpEmailErrorAuthenticate", {
                    defaultValue:
                        "An unexpected error occurred. Please try again."
                })
            );
        } finally {
            setLoadingLogin(false);
        }
    };

    const onPinSubmit = async (values: z.infer<typeof pinSchema>) => {
        setLoadingLogin(true);
        setPincodeError(null);

        try {
            const response = await resourcePincodeProxy(props.resource.id, {
                pincode: values.pin
            });

            if (response.error) {
                setPincodeError(response.message);
                return;
            }

            const session = response.data!.session;
            if (session) {
                window.location.href = appendRequestToken(
                    props.redirect,
                    session
                );
            }
        } catch (e: any) {
            console.error(e);
            setPincodeError(
                t("pincodeErrorAuthenticate", {
                    defaultValue:
                        "An unexpected error occurred. Please try again."
                })
            );
        } finally {
            setLoadingLogin(false);
        }
    };

    const onPasswordSubmit = async (values: z.infer<typeof passwordSchema>) => {
        setLoadingLogin(true);
        setPasswordError(null);

        try {
            const response = await resourcePasswordProxy(props.resource.id, {
                password: values.password
            });

            if (response.error) {
                setPasswordError(response.message);
                return;
            }

            const session = response.data!.session;
            if (session) {
                window.location.href = appendRequestToken(
                    props.redirect,
                    session
                );
            }
        } catch (e: any) {
            console.error(e);
            setPasswordError(
                t("passwordErrorAuthenticate", {
                    defaultValue:
                        "An unexpected error occurred. Please try again."
                })
            );
        } finally {
            setLoadingLogin(false);
        }
    };

    async function handleSSOAuth() {
        let isAllowed = false;
        try {
            const response = await resourceAccessProxy(props.resource.id);
            if (response.error) {
                setAccessDenied(true);
            } else {
                isAllowed = true;
            }
        } catch (e) {
            setAccessDenied(true);
        }

        if (isAllowed) {
            // window.location.href = props.redirect;
            router.refresh();
        }
    }

    function getTitle(resourceName: string) {
        if (
            build !== "oss" &&
            isUnlocked() &&
            (!!env.branding.resourceAuthPage?.titleText ||
                !!props.branding?.resourceTitle)
        ) {
            if (props.branding?.resourceTitle) {
                return replacePlaceholder(props.branding?.resourceTitle, {
                    resourceName
                });
            }
            return env.branding.resourceAuthPage?.titleText;
        }
        return t("authenticationRequired");
    }

    function getSubtitle(resourceName: string) {
        if (
            isUnlocked() &&
            build !== "oss" &&
            (env.branding.resourceAuthPage?.subtitleText ||
                props.branding?.resourceSubtitle)
        ) {
            if (props.branding?.resourceSubtitle) {
                return replacePlaceholder(props.branding?.resourceSubtitle, {
                    resourceName
                });
            }
            return env.branding.resourceAuthPage?.subtitleText
                ?.split("{{resourceName}}")
                .join(resourceName);
        }
        return numMethods > 1
            ? t("authenticationMethodChoose", { name: resourceName })
            : t("authenticationRequest", { name: resourceName });
    }

    const logoWidth = isUnlocked()
        ? (props.branding?.logoWidth ??
          env.branding.logo?.authPage?.width ??
          100)
        : 100;
    const logoHeight = isUnlocked()
        ? (props.branding?.logoHeight ??
          env.branding.logo?.authPage?.height ??
          100)
        : 100;

    return (
        <div
            style={{
                // @ts-expect-error CSS variable
                "--primary": isUnlocked() ? props.branding?.primaryColor : null
            }}
        >
            {!accessDenied ? (
                <div>
                    {isUnlocked() && build === "enterprise" ? (
                        !env.branding.resourceAuthPage?.hidePoweredBy && (
                            <div className="text-center mb-2">
                                <span className="text-sm text-muted-foreground">
                                    {t("poweredBy")}{" "}
                                    <Link
                                        href="https://pangolin.net/"
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="underline"
                                    >
                                        {env.branding.appName || "Pangolin"}
                                    </Link>
                                </span>
                            </div>
                        )
                    ) : (
                        <div className="text-center mb-2">
                            <span className="text-sm text-muted-foreground">
                                {t("poweredBy")}{" "}
                                <Link
                                    href="https://pangolin.net/"
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="underline"
                                >
                                    Pangolin
                                </Link>
                            </span>
                        </div>
                    )}
                    <Card>
                        <CardHeader>
                            {isUnlocked() &&
                                build !== "oss" &&
                                (env.branding?.resourceAuthPage?.showLogo ||
                                    props.branding) && (
                                    <div className="flex flex-row items-center justify-center mb-3">
                                        <BrandingLogo
                                            height={logoHeight}
                                            width={logoWidth}
                                            logoPath={props.branding?.logoUrl}
                                        />
                                    </div>
                                )}
                            <CardTitle>
                                {getTitle(props.resource.name)}
                            </CardTitle>
                            <CardDescription>
                                {getSubtitle(props.resource.name)}
                            </CardDescription>
                        </CardHeader>
                        <CardContent>
                            <Tabs
                                value={activeTab}
                                onValueChange={setActiveTab}
                                orientation="horizontal"
                            >
                                {numMethods > 1 && (
                                    <TabsList
                                        className={`grid w-full ${
                                            numMethods === 1
                                                ? "grid-cols-1"
                                                : numMethods === 2
                                                  ? "grid-cols-2"
                                                  : numMethods === 3
                                                    ? "grid-cols-3"
                                                    : "grid-cols-4"
                                        }`}
                                    >
                                        {props.methods.pincode && (
                                            <TabsTrigger value="pin">
                                                <Binary className="w-4 h-4 mr-1" />{" "}
                                                PIN
                                            </TabsTrigger>
                                        )}
                                        {props.methods.password && (
                                            <TabsTrigger value="password">
                                                <Key className="w-4 h-4 mr-1" />{" "}
                                                {t("password")}
                                            </TabsTrigger>
                                        )}
                                        {props.methods.sso && (
                                            <TabsTrigger value="sso">
                                                <User className="w-4 h-4 mr-1" />{" "}
                                                {t("user")}
                                            </TabsTrigger>
                                        )}
                                        {props.methods.whitelist && (
                                            <TabsTrigger value="whitelist">
                                                <AtSign className="w-4 h-4 mr-1" />{" "}
                                                {t("email")}
                                            </TabsTrigger>
                                        )}
                                    </TabsList>
                                )}
                                {props.methods.pincode && (
                                    <TabsContent
                                        value="pin"
                                        className={`${numMethods <= 1 ? "mt-0" : ""}`}
                                    >
                                        <Form {...pinForm}>
                                            <form
                                                onSubmit={pinForm.handleSubmit(
                                                    onPinSubmit
                                                )}
                                                className="space-y-4"
                                            >
                                                <FormField
                                                    control={pinForm.control}
                                                    name="pin"
                                                    render={({ field }) => (
                                                        <FormItem>
                                                            <FormLabel>
                                                                {t(
                                                                    "pincodeInput"
                                                                )}
                                                            </FormLabel>
                                                            <FormControl>
                                                                <div className="flex justify-center">
                                                                    <InputOTP
                                                                        maxLength={
                                                                            6
                                                                        }
                                                                        {...field}
                                                                    >
                                                                        <InputOTPGroup className="flex">
                                                                            <InputOTPSlot
                                                                                index={
                                                                                    0
                                                                                }
                                                                                obscured
                                                                            />
                                                                            <InputOTPSlot
                                                                                index={
                                                                                    1
                                                                                }
                                                                                obscured
                                                                            />
                                                                            <InputOTPSlot
                                                                                index={
                                                                                    2
                                                                                }
                                                                                obscured
                                                                            />
                                                                            <InputOTPSlot
                                                                                index={
                                                                                    3
                                                                                }
                                                                                obscured
                                                                            />
                                                                            <InputOTPSlot
                                                                                index={
                                                                                    4
                                                                                }
                                                                                obscured
                                                                            />
                                                                            <InputOTPSlot
                                                                                index={
                                                                                    5
                                                                                }
                                                                                obscured
                                                                            />
                                                                        </InputOTPGroup>
                                                                    </InputOTP>
                                                                </div>
                                                            </FormControl>
                                                            <FormMessage />
                                                        </FormItem>
                                                    )}
                                                />
                                                {pincodeError && (
                                                    <Alert variant="destructive">
                                                        <AlertDescription>
                                                            {pincodeError}
                                                        </AlertDescription>
                                                    </Alert>
                                                )}
                                                <Button
                                                    type="submit"
                                                    className="w-full"
                                                    loading={loadingLogin}
                                                    disabled={loadingLogin}
                                                >
                                                    <LockIcon className="w-4 h-4 mr-2" />
                                                    {t("pincodeSubmit")}
                                                </Button>
                                            </form>
                                        </Form>
                                    </TabsContent>
                                )}
                                {props.methods.password && (
                                    <TabsContent
                                        value="password"
                                        className={`${numMethods <= 1 ? "mt-0" : ""}`}
                                    >
                                        <Form {...passwordForm}>
                                            <form
                                                onSubmit={passwordForm.handleSubmit(
                                                    onPasswordSubmit
                                                )}
                                                className="space-y-4"
                                            >
                                                <FormField
                                                    control={
                                                        passwordForm.control
                                                    }
                                                    name="password"
                                                    render={({ field }) => (
                                                        <FormItem>
                                                            <FormLabel>
                                                                {t("password")}
                                                            </FormLabel>
                                                            <FormControl>
                                                                <Input
                                                                    type="password"
                                                                    {...field}
                                                                />
                                                            </FormControl>
                                                            <FormMessage />
                                                        </FormItem>
                                                    )}
                                                />

                                                {passwordError && (
                                                    <Alert variant="destructive">
                                                        <AlertDescription>
                                                            {passwordError}
                                                        </AlertDescription>
                                                    </Alert>
                                                )}

                                                <Button
                                                    type="submit"
                                                    className="w-full"
                                                    loading={loadingLogin}
                                                    disabled={loadingLogin}
                                                >
                                                    <LockIcon className="w-4 h-4 mr-2" />
                                                    {t("passwordSubmit")}
                                                </Button>
                                            </form>
                                        </Form>
                                    </TabsContent>
                                )}
                                {props.methods.sso && (
                                    <TabsContent
                                        value="sso"
                                        className={`${numMethods <= 1 ? "mt-0" : ""}`}
                                    >
                                        <LoginForm
                                            idps={props.idps}
                                            redirect={props.redirect}
                                            orgId={props.orgId}
                                            onLogin={async () =>
                                                await handleSSOAuth()
                                            }
                                        />
                                    </TabsContent>
                                )}
                                {props.methods.whitelist && (
                                    <TabsContent
                                        value="whitelist"
                                        className={`${numMethods <= 1 ? "mt-0" : ""}`}
                                    >
                                        {otpState === "idle" && (
                                            <Form {...requestOtpForm}>
                                                <form
                                                    onSubmit={requestOtpForm.handleSubmit(
                                                        onWhitelistSubmit
                                                    )}
                                                    className="space-y-4"
                                                >
                                                    <FormField
                                                        control={
                                                            requestOtpForm.control
                                                        }
                                                        name="email"
                                                        render={({ field }) => (
                                                            <FormItem>
                                                                <FormLabel>
                                                                    {t("email")}
                                                                </FormLabel>
                                                                <FormControl>
                                                                    <Input
                                                                        type="email"
                                                                        {...field}
                                                                    />
                                                                </FormControl>
                                                                <FormDescription>
                                                                    {t(
                                                                        "otpEmailDescription"
                                                                    )}
                                                                </FormDescription>
                                                                <FormMessage />
                                                            </FormItem>
                                                        )}
                                                    />

                                                    {whitelistError && (
                                                        <Alert variant="destructive">
                                                            <AlertDescription>
                                                                {whitelistError}
                                                            </AlertDescription>
                                                        </Alert>
                                                    )}

                                                    <Button
                                                        type="submit"
                                                        className="w-full"
                                                        loading={loadingLogin}
                                                        disabled={loadingLogin}
                                                    >
                                                        <Send className="w-4 h-4 mr-2" />
                                                        {t("otpEmailSend")}
                                                    </Button>
                                                </form>
                                            </Form>
                                        )}

                                        {otpState === "otp_sent" && (
                                            <Form {...submitOtpForm}>
                                                <form
                                                    onSubmit={submitOtpForm.handleSubmit(
                                                        onWhitelistSubmit
                                                    )}
                                                    className="space-y-4"
                                                >
                                                    <FormField
                                                        control={
                                                            submitOtpForm.control
                                                        }
                                                        name="otp"
                                                        render={({ field }) => (
                                                            <FormItem>
                                                                <FormLabel>
                                                                    {t(
                                                                        "otpEmail"
                                                                    )}
                                                                </FormLabel>
                                                                <FormControl>
                                                                    <Input
                                                                        type="password"
                                                                        {...field}
                                                                    />
                                                                </FormControl>
                                                                <FormMessage />
                                                            </FormItem>
                                                        )}
                                                    />

                                                    {whitelistError && (
                                                        <Alert variant="destructive">
                                                            <AlertDescription>
                                                                {whitelistError}
                                                            </AlertDescription>
                                                        </Alert>
                                                    )}

                                                    <Button
                                                        type="submit"
                                                        className="w-full"
                                                        loading={loadingLogin}
                                                        disabled={loadingLogin}
                                                    >
                                                        <LockIcon className="w-4 h-4 mr-2" />
                                                        {t("otpEmailSubmit")}
                                                    </Button>

                                                    <Button
                                                        type="button"
                                                        className="w-full"
                                                        variant={"outline"}
                                                        onClick={() => {
                                                            setOtpState("idle");
                                                            submitOtpForm.reset();
                                                        }}
                                                    >
                                                        {t("backToEmail")}
                                                    </Button>
                                                </form>
                                            </Form>
                                        )}
                                    </TabsContent>
                                )}
                            </Tabs>
                        </CardContent>
                    </Card>
                    {supporterStatus?.visible && (
                        <div className="text-center mt-2">
                            <span className="text-sm text-muted-foreground opacity-50">
                                {t("noSupportKey")}
                            </span>
                        </div>
                    )}
                    {build === "enterprise" && !isUnlocked() ? (
                        <div className="text-center mt-2">
                            <span className="text-sm font-medium text-muted-foreground">
                                {t("instanceIsUnlicensed")}
                            </span>
                        </div>
                    ) : null}
                    {build === "enterprise" &&
                    isUnlocked() &&
                    licenseStatus?.tier === "personal" ? (
                        <div className="text-center mt-2">
                            <span className="text-sm font-medium text-muted-foreground">
                                {t("loginPageLicenseWatermark")}
                            </span>
                        </div>
                    ) : null}
                </div>
            ) : (
                <ResourceAccessDenied />
            )}
        </div>
    );
}
