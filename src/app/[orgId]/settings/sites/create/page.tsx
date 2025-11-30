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
import { StrategySelect } from "@app/components/StrategySelect";
import {
    Form,
    FormControl,
    FormDescription,
    FormField,
    FormItem,
    FormLabel,
    FormMessage
} from "@app/components/ui/form";
import HeaderTitle from "@app/components/SettingsSectionTitle";
import { z } from "zod";
import { createElement, useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Input } from "@app/components/ui/input";
import { InfoIcon, Terminal } from "lucide-react";
import { Button } from "@app/components/ui/button";
import CopyTextBox from "@app/components/CopyTextBox";
import CopyToClipboard from "@app/components/CopyToClipboard";
import {
    InfoSection,
    InfoSectionContent,
    InfoSections,
    InfoSectionTitle
} from "@app/components/InfoSection";
import {
    FaApple,
    FaCubes,
    FaDocker,
    FaFreebsd,
    FaWindows
} from "react-icons/fa";
import { SiNixos, SiKubernetes } from "react-icons/si";
import { Checkbox, CheckboxWithLabel } from "@app/components/ui/checkbox";
import { Alert, AlertDescription, AlertTitle } from "@app/components/ui/alert";
import { generateKeypair } from "../[niceId]/wireguardConfig";
import { createApiClient, formatAxiosError } from "@app/lib/api";
import { useEnvContext } from "@app/hooks/useEnvContext";
import {
    CreateSiteBody,
    CreateSiteResponse,
    PickSiteDefaultsResponse
} from "@server/routers/site";
import { ListRemoteExitNodesResponse } from "@server/routers/remoteExitNode/types";
import { toast } from "@app/hooks/useToast";
import { AxiosResponse } from "axios";
import { useParams, useRouter } from "next/navigation";
import { QRCodeCanvas } from "qrcode.react";

import { useTranslations } from "next-intl";
import { build } from "@server/build";

type SiteType = "newt" | "wireguard" | "local";

interface TunnelTypeOption {
    id: SiteType;
    title: string;
    description: string;
    disabled?: boolean;
}

interface RemoteExitNodeOption {
    id: string;
    title: string;
    description: string;
    disabled?: boolean;
}

type Commands = {
    unix: Record<string, string[]>;
    windows: Record<string, string[]>;
    docker: Record<string, string[]>;
    kubernetes: Record<string, string[]>;
    podman: Record<string, string[]>;
    nixos: Record<string, string[]>;
};

const platforms = [
    "unix",
    "docker",
    "kubernetes",
    "podman",
    "windows",
    "nixos"
] as const;

type Platform = (typeof platforms)[number];

export default function Page() {
    const { env } = useEnvContext();
    const api = createApiClient({ env });
    const { orgId } = useParams();
    const router = useRouter();
    const t = useTranslations();

    const createSiteFormSchema = z
        .object({
            name: z
                .string()
                .min(2, { message: t("nameMin", { len: 2 }) })
                .max(30, {
                    message: t("nameMax", { len: 30 })
                }),
            method: z.enum(["newt", "wireguard", "local"]),
            copied: z.boolean(),
            clientAddress: z.string().optional(),
            acceptClients: z.boolean(),
            exitNodeId: z.number().optional()
        })
        .refine(
            (data) => {
                if (data.method !== "local") {
                    // return data.copied;
                    return true;
                }
                // For local sites, require exitNodeId
                return build == "saas" ? data.exitNodeId !== undefined : true;
            },
            {
                message: t("sitesConfirmCopy"),
                path: ["copied"]
            }
        )
        .refine(
            (data) => {
                if (data.method === "local" && build == "saas") {
                    return data.exitNodeId !== undefined;
                }
                return true;
            },
            {
                message: t("remoteExitNodeRequired"),
                path: ["exitNodeId"]
            }
        );

    type CreateSiteFormValues = z.infer<typeof createSiteFormSchema>;

    const [tunnelTypes, setTunnelTypes] = useState<
        ReadonlyArray<TunnelTypeOption>
    >([
        {
            id: "newt",
            title: t("siteNewtTunnel"),
            description: t("siteNewtTunnelDescription"),
            disabled: true
        },
        ...(env.flags.disableBasicWireguardSites
            ? []
            : [
                  {
                      id: "wireguard" as SiteType,
                      title: t("siteWg"),
                      description:
                          build == "saas"
                              ? t("siteWgDescriptionSaas")
                              : t("siteWgDescription"),
                      disabled: true
                  }
              ]),
        ...(env.flags.disableLocalSites
            ? []
            : [
                  {
                      id: "local" as SiteType,
                      title: t("local"),
                      description:
                          build == "saas"
                              ? t("siteLocalDescriptionSaas")
                              : t("siteLocalDescription")
                  }
              ])
    ]);

    const [loadingPage, setLoadingPage] = useState(true);

    const [platform, setPlatform] = useState<Platform>("unix");
    const [architecture, setArchitecture] = useState("amd64");
    const [commands, setCommands] = useState<Commands | null>(null);

    const [newtId, setNewtId] = useState("");
    const [newtSecret, setNewtSecret] = useState("");
    const [newtEndpoint, setNewtEndpoint] = useState("");
    const [clientAddress, setClientAddress] = useState("");
    const [publicKey, setPublicKey] = useState("");
    const [privateKey, setPrivateKey] = useState("");
    const [wgConfig, setWgConfig] = useState("");

    const [createLoading, setCreateLoading] = useState(false);
    const [acceptClients, setAcceptClients] = useState(false);
    const [newtVersion, setNewtVersion] = useState("latest");

    const [siteDefaults, setSiteDefaults] =
        useState<PickSiteDefaultsResponse | null>(null);

    const [remoteExitNodeOptions, setRemoteExitNodeOptions] = useState<
        ReadonlyArray<RemoteExitNodeOption>
    >([]);
    const [selectedExitNodeId, setSelectedExitNodeId] = useState<
        string | undefined
    >();

    const hydrateWireGuardConfig = (
        privateKey: string,
        publicKey: string,
        subnet: string,
        address: string,
        endpoint: string,
        listenPort: string
    ) => {
        const wgConfig = `[Interface]
Address = ${subnet}
ListenPort = 51820
PrivateKey = ${privateKey}

[Peer]
PublicKey = ${publicKey}
AllowedIPs = ${address.split("/")[0]}/32
Endpoint = ${endpoint}:${listenPort}
PersistentKeepalive = 5`;
        setWgConfig(wgConfig);
    };

    const hydrateCommands = (
        id: string,
        secret: string,
        endpoint: string,
        version: string,
        acceptClients: boolean = false
    ) => {
        const acceptClientsFlag = acceptClients ? " --accept-clients" : "";
        const acceptClientsEnv = acceptClients
            ? "\n      - ACCEPT_CLIENTS=true"
            : "";

        const commands = {
            unix: {
                All: [
                    `curl -fsSL https://pangolin.net/get-newt.sh | bash`,
                    `newt --id ${id} --secret ${secret} --endpoint ${endpoint}${acceptClientsFlag}`
                ]
            },
            windows: {
                x64: [
                    `curl -o newt.exe -L "https://github.com/fosrl/newt/releases/download/${version}/newt_windows_amd64.exe"`,
                    `newt.exe --id ${id} --secret ${secret} --endpoint ${endpoint}${acceptClientsFlag}`
                ]
            },
            docker: {
                "Docker Compose": [
                    `services:
  newt:
    image: fosrl/newt
    container_name: newt
    restart: unless-stopped
    environment:
      - PANGOLIN_ENDPOINT=${endpoint}
      - NEWT_ID=${id}
      - NEWT_SECRET=${secret}${acceptClientsEnv}`
                ],
                "Docker Run": [
                    `docker run -dit fosrl/newt --id ${id} --secret ${secret} --endpoint ${endpoint}${acceptClientsFlag}`
                ]
            },
            kubernetes: {
                "Helm Chart": [
                    `helm repo add fossorial https://charts.fossorial.io`,
                    `helm repo update fossorial`,
                    `helm install newt fossorial/newt \\
    --create-namespace \\
    --set newtInstances[0].name="main-tunnel" \\
    --set-string newtInstances[0].auth.keys.endpointKey="${endpoint}" \\
    --set-string newtInstances[0].auth.keys.idKey="${id}" \\
    --set-string newtInstances[0].auth.keys.secretKey="${secret}"`
                ]
            },
            podman: {
                "Podman Quadlet": [
                    `[Unit]
Description=Newt container

[Container]
ContainerName=newt
Image=docker.io/fosrl/newt
Environment=PANGOLIN_ENDPOINT=${endpoint}
Environment=NEWT_ID=${id}
Environment=NEWT_SECRET=${secret}${acceptClients ? "\nEnvironment=ACCEPT_CLIENTS=true" : ""}
# Secret=newt-secret,type=env,target=NEWT_SECRET

[Service]
Restart=always

[Install]
WantedBy=default.target`
                ],
                "Podman Run": [
                    `podman run -dit docker.io/fosrl/newt --id ${id} --secret ${secret} --endpoint ${endpoint}${acceptClientsFlag}`
                ]
            },
            nixos: {
                All: [
                    `nix run 'nixpkgs#fosrl-newt' -- --id ${id} --secret ${secret} --endpoint ${endpoint}${acceptClientsFlag}`
                ]
            }
        };
        setCommands(commands);
    };

    const getArchitectures = () => {
        switch (platform) {
            case "unix":
                return ["All"];
            case "windows":
                return ["x64"];
            case "docker":
                return ["Docker Compose", "Docker Run"];
            case "kubernetes":
                return ["Helm Chart"];
            case "podman":
                return ["Podman Quadlet", "Podman Run"];
            case "nixos":
                return ["All"];
            default:
                return ["x64"];
        }
    };

    const getPlatformName = (platformName: string) => {
        switch (platformName) {
            case "windows":
                return "Windows";
            case "unix":
                return "Unix & macOS";
            case "docker":
                return "Docker";
            case "kubernetes":
                return "Kubernetes";
            case "podman":
                return "Podman";
            case "nixos":
                return "NixOS";
            default:
                return "Unix / macOS";
        }
    };

    const getCommand = () => {
        const placeholder = [t("unknownCommand")];
        if (!commands) {
            return placeholder;
        }
        let platformCommands = commands[platform as keyof Commands];

        if (!platformCommands) {
            // get first key
            const firstPlatform = Object.keys(commands)[0] as Platform;
            platformCommands = commands[firstPlatform as keyof Commands];

            setPlatform(firstPlatform);
        }

        let architectureCommands = platformCommands[architecture];
        if (!architectureCommands) {
            // get first key
            const firstArchitecture = Object.keys(platformCommands)[0];
            architectureCommands = platformCommands[firstArchitecture];

            setArchitecture(firstArchitecture);
        }

        return architectureCommands || placeholder;
    };

    const getPlatformIcon = (platformName: string) => {
        switch (platformName) {
            case "windows":
                return <FaWindows className="h-4 w-4 mr-2" />;
            case "unix":
                return <Terminal className="h-4 w-4 mr-2" />;
            case "docker":
                return <FaDocker className="h-4 w-4 mr-2" />;
            case "kubernetes":
                return <SiKubernetes className="h-4 w-4 mr-2" />;
            case "podman":
                return <FaCubes className="h-4 w-4 mr-2" />;
            case "nixos":
                return <SiNixos className="h-4 w-4 mr-2" />;
            default:
                return <Terminal className="h-4 w-4 mr-2" />;
        }
    };

    const form = useForm({
        resolver: zodResolver(createSiteFormSchema),
        defaultValues: {
            name: "",
            copied: false,
            method: "newt",
            clientAddress: "",
            acceptClients: false,
            exitNodeId: undefined
        }
    });

    async function onSubmit(data: CreateSiteFormValues) {
        setCreateLoading(true);

        let payload: CreateSiteBody = {
            name: data.name,
            type: data.method as "newt" | "wireguard" | "local"
        };

        if (data.method == "wireguard") {
            if (!siteDefaults || !wgConfig) {
                toast({
                    variant: "destructive",
                    title: t("siteErrorCreate"),
                    description: t("siteErrorCreateKeyPair")
                });
                setCreateLoading(false);
                return;
            }

            payload = {
                ...payload,
                subnet: siteDefaults.subnet,
                exitNodeId: siteDefaults.exitNodeId,
                pubKey: publicKey
            };
        }
        if (data.method === "newt") {
            if (!siteDefaults) {
                toast({
                    variant: "destructive",
                    title: t("siteErrorCreate"),
                    description: t("siteErrorCreateDefaults")
                });
                setCreateLoading(false);
                return;
            }

            payload = {
                ...payload,
                subnet: siteDefaults.subnet,
                exitNodeId: siteDefaults.exitNodeId,
                secret: siteDefaults.newtSecret,
                newtId: siteDefaults.newtId,
                address: clientAddress
            };
        }
        if (data.method === "local" && build == "saas") {
            if (!data.exitNodeId) {
                toast({
                    variant: "destructive",
                    title: t("siteErrorCreate"),
                    description: t("remoteExitNodeRequired")
                });
                setCreateLoading(false);
                return;
            }

            payload = {
                ...payload,
                exitNodeId: data.exitNodeId
            };
        }

        const res = await api
            .put<
                AxiosResponse<CreateSiteResponse>
            >(`/org/${orgId}/site/`, payload)
            .catch((e) => {
                toast({
                    variant: "destructive",
                    title: t("siteErrorCreate"),
                    description: formatAxiosError(e)
                });
            });

        if (res && res.status === 201) {
            const data = res.data.data;

            router.push(`/${orgId}/settings/sites/${data.niceId}`);
        }

        setCreateLoading(false);
    }

    useEffect(() => {
        const load = async () => {
            setLoadingPage(true);

            let currentNewtVersion = "latest";

            try {
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), 3000);

                const response = await fetch(
                    `https://api.github.com/repos/fosrl/newt/releases/latest`,
                    { signal: controller.signal }
                );

                clearTimeout(timeoutId);

                if (!response.ok) {
                    throw new Error(
                        t("newtErrorFetchReleases", {
                            err: response.statusText
                        })
                    );
                }
                const data = await response.json();
                const latestVersion = data.tag_name;
                currentNewtVersion = latestVersion;
                setNewtVersion(latestVersion);
            } catch (error) {
                if (error instanceof Error && error.name === "AbortError") {
                    console.error(t("newtErrorFetchTimeout"));
                } else {
                    console.error(
                        t("newtErrorFetchLatest", {
                            err:
                                error instanceof Error
                                    ? error.message
                                    : String(error)
                        })
                    );
                }
            }

            const generatedKeypair = generateKeypair();

            const privateKey = generatedKeypair.privateKey;
            const publicKey = generatedKeypair.publicKey;

            setPrivateKey(privateKey);
            setPublicKey(publicKey);

            await api
                .get(`/org/${orgId}/pick-site-defaults`)
                .catch((e) => {
                    // update the default value of the form to be local method only if local sites are not disabled
                    if (!env.flags.disableLocalSites) {
                        form.setValue("method", "local");
                    }
                })
                .then((res) => {
                    if (res && res.status === 200) {
                        const data = res.data.data;

                        setSiteDefaults(data);

                        const newtId = data.newtId;
                        const newtSecret = data.newtSecret;
                        const newtEndpoint = data.endpoint;
                        const clientAddress = data.clientAddress;

                        setNewtId(newtId);
                        setNewtSecret(newtSecret);
                        setNewtEndpoint(newtEndpoint);
                        setClientAddress(clientAddress);

                        hydrateCommands(
                            newtId,
                            newtSecret,
                            env.app.dashboardUrl,
                            currentNewtVersion,
                            acceptClients
                        );

                        hydrateWireGuardConfig(
                            privateKey,
                            data.publicKey,
                            data.subnet,
                            data.address,
                            data.endpoint,
                            data.listenPort
                        );

                        setTunnelTypes((prev: any) => {
                            return prev.map((item: any) => {
                                return { ...item, disabled: false };
                            });
                        });
                    }
                });

            if (build === "saas") {
                // Fetch remote exit nodes for local sites
                try {
                    const remoteExitNodesRes = await api.get<
                        AxiosResponse<ListRemoteExitNodesResponse>
                    >(`/org/${orgId}/remote-exit-nodes`);

                    if (
                        remoteExitNodesRes &&
                        remoteExitNodesRes.status === 200
                    ) {
                        const exitNodes =
                            remoteExitNodesRes.data.data.remoteExitNodes;

                        // Convert to options for StrategySelect
                        const exitNodeOptions: RemoteExitNodeOption[] =
                            exitNodes
                                .filter((node) => node.exitNodeId !== null)
                                .map((node) => ({
                                    id: node.exitNodeId!.toString(),
                                    title: node.name,
                                    description: `${node.address?.split("/")[0] || "N/A"} - ${node.endpoint || "N/A"}`
                                }));

                        setRemoteExitNodeOptions(exitNodeOptions);
                    }
                } catch (error) {
                    console.error("Failed to fetch remote exit nodes:", error);
                }
            }

            setLoadingPage(false);
        };

        load();
    }, []);

    // Sync form acceptClients value with local state
    useEffect(() => {
        form.setValue("acceptClients", acceptClients);
    }, [acceptClients, form]);

    // Sync form exitNodeId value with local state
    useEffect(() => {
        if (build !== "saas") {
            // dont update the form
            return;
        }
        form.setValue(
            "exitNodeId",
            selectedExitNodeId ? parseInt(selectedExitNodeId) : undefined
        );
    }, [selectedExitNodeId, form]);

    return (
        <>
            <div className="flex justify-between">
                <HeaderTitle
                    title={t("siteCreate")}
                    description={t("siteCreateDescription2")}
                />
                <Button
                    variant="outline"
                    onClick={() => {
                        router.push(`/${orgId}/settings/sites`);
                    }}
                >
                    {t("siteSeeAll")}
                </Button>
            </div>

            {!loadingPage && (
                <div>
                    <SettingsContainer>
                        <SettingsSection>
                            <SettingsSectionHeader>
                                <SettingsSectionTitle>
                                    {t("siteInfo")}
                                </SettingsSectionTitle>
                            </SettingsSectionHeader>
                            <SettingsSectionBody>
                                <SettingsSectionForm>
                                    <Form {...form}>
                                        <form
                                            onKeyDown={(e) => {
                                                if (e.key === "Enter") {
                                                    e.preventDefault(); // block default enter refresh
                                                }
                                            }}
                                            className="space-y-4"
                                            id="create-site-form"
                                        >
                                            <FormField
                                                control={form.control}
                                                name="name"
                                                render={({ field }) => (
                                                    <FormItem>
                                                        <FormLabel>
                                                            {t("name")}
                                                        </FormLabel>
                                                        <FormControl>
                                                            <Input
                                                                autoComplete="off"
                                                                {...field}
                                                            />
                                                        </FormControl>
                                                        <FormMessage />
                                                    </FormItem>
                                                )}
                                            />
                                            {env.flags.enableClients &&
                                                form.watch("method") ===
                                                    "newt" && (
                                                    <FormField
                                                        control={form.control}
                                                        name="clientAddress"
                                                        render={({ field }) => (
                                                            <FormItem>
                                                                <FormLabel>
                                                                    {t(
                                                                        "siteAddress"
                                                                    )}
                                                                </FormLabel>
                                                                <FormControl>
                                                                    <Input
                                                                        autoComplete="off"
                                                                        value={
                                                                            clientAddress
                                                                        }
                                                                        onChange={(
                                                                            e
                                                                        ) => {
                                                                            setClientAddress(
                                                                                e
                                                                                    .target
                                                                                    .value
                                                                            );
                                                                            field.onChange(
                                                                                e
                                                                                    .target
                                                                                    .value
                                                                            );
                                                                        }}
                                                                    />
                                                                </FormControl>
                                                                <FormMessage />
                                                                <FormDescription>
                                                                    {t(
                                                                        "siteAddressDescription"
                                                                    )}
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

                        {tunnelTypes.length > 1 && (
                            <SettingsSection>
                                <SettingsSectionHeader>
                                    <SettingsSectionTitle>
                                        {t("tunnelType")}
                                    </SettingsSectionTitle>
                                    <SettingsSectionDescription>
                                        {t("siteTunnelDescription")}
                                    </SettingsSectionDescription>
                                </SettingsSectionHeader>
                                <SettingsSectionBody>
                                    <StrategySelect
                                        options={tunnelTypes}
                                        defaultValue={form.getValues("method")}
                                        onChange={(value) => {
                                            form.setValue("method", value);
                                        }}
                                        cols={3}
                                    />
                                </SettingsSectionBody>
                            </SettingsSection>
                        )}

                        {form.watch("method") === "newt" && (
                            <>
                                <SettingsSection>
                                    <SettingsSectionHeader>
                                        <SettingsSectionTitle>
                                            {t("siteNewtCredentials")}
                                        </SettingsSectionTitle>
                                        <SettingsSectionDescription>
                                            {t(
                                                "siteNewtCredentialsDescription"
                                            )}
                                        </SettingsSectionDescription>
                                    </SettingsSectionHeader>
                                    <SettingsSectionBody>
                                        <InfoSections cols={3}>
                                            <InfoSection>
                                                <InfoSectionTitle>
                                                    {t("newtEndpoint")}
                                                </InfoSectionTitle>
                                                <InfoSectionContent>
                                                    <CopyToClipboard
                                                        text={
                                                            env.app.dashboardUrl
                                                        }
                                                    />
                                                </InfoSectionContent>
                                            </InfoSection>
                                            <InfoSection>
                                                <InfoSectionTitle>
                                                    {t("newtId")}
                                                </InfoSectionTitle>
                                                <InfoSectionContent>
                                                    <CopyToClipboard
                                                        text={newtId}
                                                    />
                                                </InfoSectionContent>
                                            </InfoSection>
                                            <InfoSection>
                                                <InfoSectionTitle>
                                                    {t("newtSecretKey")}
                                                </InfoSectionTitle>
                                                <InfoSectionContent>
                                                    <CopyToClipboard
                                                        text={newtSecret}
                                                    />
                                                </InfoSectionContent>
                                            </InfoSection>
                                        </InfoSections>

                                        <Alert variant="neutral" className="">
                                            <InfoIcon className="h-4 w-4" />
                                            <AlertTitle className="font-semibold">
                                                {t("siteCredentialsSave")}
                                            </AlertTitle>
                                            <AlertDescription>
                                                {t(
                                                    "siteCredentialsSaveDescription"
                                                )}
                                            </AlertDescription>
                                        </Alert>

                                        {/* <Form {...form}> */}
                                        {/*     <form */}
                                        {/*         className="space-y-4" */}
                                        {/*         id="create-site-form" */}
                                        {/*     > */}
                                        {/*         <FormField */}
                                        {/*             control={form.control} */}
                                        {/*             name="copied" */}
                                        {/*             render={({ field }) => ( */}
                                        {/*                 <FormItem> */}
                                        {/*                     <div className="flex items-center space-x-2"> */}
                                        {/*                         <Checkbox */}
                                        {/*                             id="terms" */}
                                        {/*                             defaultChecked={ */}
                                        {/*                                 form.getValues( */}
                                        {/*                                     "copied" */}
                                        {/*                                 ) as boolean */}
                                        {/*                             } */}
                                        {/*                             onCheckedChange={( */}
                                        {/*                                 e */}
                                        {/*                             ) => { */}
                                        {/*                                 form.setValue( */}
                                        {/*                                     "copied", */}
                                        {/*                                     e as boolean */}
                                        {/*                                 ); */}
                                        {/*                             }} */}
                                        {/*                         /> */}
                                        {/*                         <label */}
                                        {/*                             htmlFor="terms" */}
                                        {/*                             className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70" */}
                                        {/*                         > */}
                                        {/*                             {t('siteConfirmCopy')} */}
                                        {/*                         </label> */}
                                        {/*                     </div> */}
                                        {/*                     <FormMessage /> */}
                                        {/*                 </FormItem> */}
                                        {/*             )} */}
                                        {/*         /> */}
                                        {/*     </form> */}
                                        {/* </Form> */}
                                    </SettingsSectionBody>
                                </SettingsSection>
                                <SettingsSection>
                                    <SettingsSectionHeader>
                                        <SettingsSectionTitle>
                                            {t("siteInstallNewt")}
                                        </SettingsSectionTitle>
                                        <SettingsSectionDescription>
                                            {t("siteInstallNewtDescription")}
                                        </SettingsSectionDescription>
                                    </SettingsSectionHeader>
                                    <SettingsSectionBody>
                                        <div>
                                            <p className="font-bold mb-3">
                                                {t("operatingSystem")}
                                            </p>
                                            <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
                                                {platforms.map((os) => (
                                                    <Button
                                                        key={os}
                                                        variant={
                                                            platform === os
                                                                ? "squareOutlinePrimary"
                                                                : "squareOutline"
                                                        }
                                                        className={`flex-1 min-w-[120px] ${platform === os ? "bg-primary/10" : ""} shadow-none`}
                                                        onClick={() => {
                                                            setPlatform(os);
                                                        }}
                                                    >
                                                        {getPlatformIcon(os)}
                                                        {getPlatformName(os)}
                                                    </Button>
                                                ))}
                                            </div>
                                        </div>

                                        <div>
                                            <p className="font-bold mb-3">
                                                {["docker", "podman"].includes(
                                                    platform
                                                )
                                                    ? t("method")
                                                    : t("architecture")}
                                            </p>
                                            <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
                                                {getArchitectures().map(
                                                    (arch) => (
                                                        <Button
                                                            key={arch}
                                                            variant={
                                                                architecture ===
                                                                arch
                                                                    ? "squareOutlinePrimary"
                                                                    : "squareOutline"
                                                            }
                                                            className={`flex-1 min-w-[120px] ${architecture === arch ? "bg-primary/10" : ""} shadow-none`}
                                                            onClick={() =>
                                                                setArchitecture(
                                                                    arch
                                                                )
                                                            }
                                                        >
                                                            {arch}
                                                        </Button>
                                                    )
                                                )}
                                            </div>

                                            <div className="pt-4">
                                                <p className="font-bold mb-3">
                                                    {t("siteConfiguration")}
                                                </p>
                                                <div className="flex items-center space-x-2 mb-2">
                                                    <CheckboxWithLabel
                                                        id="acceptClients"
                                                        aria-describedby="acceptClients-desc"
                                                        checked={acceptClients}
                                                        onCheckedChange={(
                                                            checked
                                                        ) => {
                                                            const value =
                                                                checked as boolean;
                                                            setAcceptClients(
                                                                value
                                                            );
                                                            form.setValue(
                                                                "acceptClients",
                                                                value
                                                            );
                                                            // Re-hydrate commands with new acceptClients value
                                                            if (
                                                                newtId &&
                                                                newtSecret &&
                                                                newtVersion
                                                            ) {
                                                                hydrateCommands(
                                                                    newtId,
                                                                    newtSecret,
                                                                    env.app
                                                                        .dashboardUrl,
                                                                    newtVersion,
                                                                    value
                                                                );
                                                            }
                                                        }}
                                                        label={t(
                                                            "siteAcceptClientConnections"
                                                        )}
                                                    />
                                                </div>
                                                <p
                                                    id="acceptClients-desc"
                                                    className="text-sm text-muted-foreground mb-4"
                                                >
                                                    {t(
                                                        "siteAcceptClientConnectionsDescription"
                                                    )}
                                                </p>
                                            </div>

                                            <div className="pt-4">
                                                <p className="font-bold mb-3">
                                                    {t("commands")}
                                                </p>
                                                <div className="mt-2">
                                                    <CopyTextBox
                                                        text={getCommand().join(
                                                            "\n"
                                                        )}
                                                        outline={true}
                                                    />
                                                </div>
                                            </div>
                                        </div>
                                    </SettingsSectionBody>
                                </SettingsSection>
                            </>
                        )}

                        {form.watch("method") === "wireguard" && (
                            <SettingsSection>
                                <SettingsSectionHeader>
                                    <SettingsSectionTitle>
                                        {t("WgConfiguration")}
                                    </SettingsSectionTitle>
                                    <SettingsSectionDescription>
                                        {t("WgConfigurationDescription")}
                                    </SettingsSectionDescription>
                                </SettingsSectionHeader>
                                <SettingsSectionBody>
                                    <div className="flex items-center gap-4">
                                        <CopyTextBox text={wgConfig} />
                                        <div
                                            className={`relative w-fit border rounded-md`}
                                        >
                                            <div className="bg-white p-6 rounded-md">
                                                <QRCodeCanvas
                                                    value={wgConfig}
                                                    size={168}
                                                    className="mx-auto"
                                                />
                                            </div>
                                        </div>
                                    </div>
                                    <Alert variant="neutral">
                                        <InfoIcon className="h-4 w-4" />
                                        <AlertTitle className="font-semibold">
                                            {t("siteCredentialsSave")}
                                        </AlertTitle>
                                        <AlertDescription>
                                            {t(
                                                "siteCredentialsSaveDescription"
                                            )}
                                        </AlertDescription>
                                    </Alert>
                                </SettingsSectionBody>
                            </SettingsSection>
                        )}

                        {build == "saas" &&
                            form.watch("method") === "local" && (
                                <SettingsSection>
                                    <SettingsSectionHeader>
                                        <SettingsSectionTitle>
                                            {t("remoteExitNodeSelection")}
                                        </SettingsSectionTitle>
                                        <SettingsSectionDescription>
                                            {t(
                                                "remoteExitNodeSelectionDescription"
                                            )}
                                        </SettingsSectionDescription>
                                    </SettingsSectionHeader>
                                    <SettingsSectionBody>
                                        {remoteExitNodeOptions.length > 0 ? (
                                            <StrategySelect
                                                options={remoteExitNodeOptions}
                                                defaultValue={
                                                    selectedExitNodeId
                                                }
                                                onChange={(value) => {
                                                    setSelectedExitNodeId(
                                                        value
                                                    );
                                                }}
                                                cols={1}
                                            />
                                        ) : (
                                            <Alert variant="destructive">
                                                <InfoIcon className="h-4 w-4" />
                                                <AlertTitle className="font-semibold">
                                                    {t(
                                                        "noRemoteExitNodesAvailable"
                                                    )}
                                                </AlertTitle>
                                                <AlertDescription>
                                                    {t(
                                                        "noRemoteExitNodesAvailableDescription"
                                                    )}
                                                </AlertDescription>
                                            </Alert>
                                        )}
                                    </SettingsSectionBody>
                                </SettingsSection>
                            )}
                    </SettingsContainer>

                    <div className="flex justify-end space-x-2 mt-8">
                        <Button
                            type="button"
                            variant="outline"
                            onClick={() => {
                                router.push(`/${orgId}/settings/sites`);
                            }}
                        >
                            {t("cancel")}
                        </Button>
                        <Button
                            type="button"
                            loading={createLoading}
                            disabled={createLoading}
                            onClick={() => {
                                form.handleSubmit(onSubmit)();
                            }}
                        >
                            {t("siteCreate")}
                        </Button>
                    </div>
                </div>
            )}
        </>
    );
}
