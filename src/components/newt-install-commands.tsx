import { useTranslations } from "next-intl";
import CopyTextBox from "./CopyTextBox";
import {
    SettingsSection,
    SettingsSectionBody,
    SettingsSectionDescription,
    SettingsSectionHeader,
    SettingsSectionTitle
} from "./Settings";
import { CheckboxWithLabel } from "./ui/checkbox";
import { Button } from "./ui/button";
import { useState } from "react";
import { FaCubes, FaDocker, FaWindows } from "react-icons/fa";
import { Terminal } from "lucide-react";
import { SiKubernetes, SiNixos } from "react-icons/si";

export type CommandItem = string | { title: string; command: string };

const PLATFORMS = [
    "unix",
    "docker",
    "kubernetes",
    "podman",
    "nixos",
    "windows"
] as const;

type Platform = (typeof PLATFORMS)[number];

export type NewtSiteInstallCommandsProps = {
    id: string;
    secret: string;
    endpoint: string;
    version?: string;
};

export function NewtSiteInstallCommands({
    id,
    secret,
    endpoint,
    version = "latest"
}: NewtSiteInstallCommandsProps) {
    const t = useTranslations();

    const [acceptClients, setAcceptClients] = useState(true);
    const [platform, setPlatform] = useState<Platform>("unix");
    const [architecture, setArchitecture] = useState(
        () => getArchitectures(platform)[0]
    );

    const acceptClientsFlag = !acceptClients ? " --disable-clients" : "";
    const acceptClientsEnv = !acceptClients
        ? "\n      - DISABLE_CLIENTS=true"
        : "";

    const commandList: Record<Platform, Record<string, CommandItem[]>> = {
        unix: {
            All: [
                {
                    title: t("install"),
                    command: `curl -fsSL https://static.pangolin.net/get-newt.sh | bash`
                },
                {
                    title: t("run"),
                    command: `newt --id ${id} --secret ${secret} --endpoint ${endpoint}${acceptClientsFlag}`
                }
            ]
        },
        windows: {
            x64: [
                {
                    title: t("install"),
                    command: `curl -o newt.exe -L "https://github.com/fosrl/newt/releases/download/${version}/newt_windows_amd64.exe"`
                },
                {
                    title: t("run"),
                    command: `newt.exe --id ${id} --secret ${secret} --endpoint ${endpoint}${acceptClientsFlag}`
                }
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
                `docker run -dit --network host fosrl/newt --id ${id} --secret ${secret} --endpoint ${endpoint}${acceptClientsFlag}`
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
Network=host
Environment=PANGOLIN_ENDPOINT=${endpoint}
Environment=NEWT_ID=${id}
Environment=NEWT_SECRET=${secret}${!acceptClients ? "\nEnvironment=DISABLE_CLIENTS=true" : ""}
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

    const commands = commandList[platform][architecture];

    return (
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
                    <p className="font-bold mb-3">{t("operatingSystem")}</p>
                    <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
                        {PLATFORMS.map((os) => (
                            <Button
                                key={os}
                                variant={
                                    platform === os
                                        ? "squareOutlinePrimary"
                                        : "squareOutline"
                                }
                                className={`flex-1 min-w-30 ${platform === os ? "bg-primary/10" : ""} shadow-none`}
                                onClick={() => {
                                    setPlatform(os);
                                    const architectures = getArchitectures(os);
                                    setArchitecture(architectures[0]);
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
                        {["docker", "podman"].includes(platform)
                            ? t("method")
                            : t("architecture")}
                    </p>
                    <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
                        {getArchitectures(platform).map((arch) => (
                            <Button
                                key={arch}
                                variant={
                                    architecture === arch
                                        ? "squareOutlinePrimary"
                                        : "squareOutline"
                                }
                                className={`flex-1 min-w-30 ${architecture === arch ? "bg-primary/10" : ""} shadow-none`}
                                onClick={() => setArchitecture(arch)}
                            >
                                {arch}
                            </Button>
                        ))}
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
                                onCheckedChange={(checked) => {
                                    const value = checked as boolean;
                                    setAcceptClients(value);
                                }}
                                label={t("siteAcceptClientConnections")}
                            />
                        </div>
                        <p
                            id="acceptClients-desc"
                            className="text-sm text-muted-foreground"
                        >
                            {t("siteAcceptClientConnectionsDescription")}
                        </p>
                    </div>

                    <div className="pt-4">
                        <p className="font-bold mb-3">{t("commands")}</p>
                        <div className="mt-2 space-y-3">
                            {commands.map((item, index) => {
                                const commandText =
                                    typeof item === "string"
                                        ? item
                                        : item.command;
                                const title =
                                    typeof item === "string"
                                        ? undefined
                                        : item.title;

                                return (
                                    <div key={index}>
                                        {title && (
                                            <p className="text-sm font-medium mb-1.5">
                                                {title}
                                            </p>
                                        )}
                                        <CopyTextBox
                                            text={commandText}
                                            outline={true}
                                        />
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                </div>
            </SettingsSectionBody>
        </SettingsSection>
    );
}

function getPlatformIcon(platformName: Platform) {
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
}

function getPlatformName(platformName: Platform) {
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
}

function getArchitectures(platform: Platform) {
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
}
