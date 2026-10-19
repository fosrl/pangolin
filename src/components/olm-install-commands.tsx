import { Download, Terminal } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { FaDocker, FaWindows } from "react-icons/fa";
import CopyTextBox from "./CopyTextBox";
import {
    SettingsSection,
    SettingsSectionBody,
    SettingsSectionDescription,
    SettingsSectionHeader,
    SettingsSectionTitle
} from "./Settings";
import { Button } from "./ui/button";
import { OptionSelect, type OptionSelectOption } from "./OptionSelect";

export type CommandItem =
    | string
    | { title: string; command: string }
    | { title: string; link: string };

const PLATFORMS = ["unix", "docker", "windows"] as const;

type Platform = (typeof PLATFORMS)[number];

export type OlmInstallCommandsProps = {
    id: string;
    secret: string;
    endpoint: string;
};

export function OlmInstallCommands({
    id,
    secret,
    endpoint
}: OlmInstallCommandsProps) {
    const t = useTranslations();

    const [platform, setPlatform] = useState<Platform>("unix");
    const [architecture, setArchitecture] = useState(
        () => getArchitectures(platform)[0]
    );

    const commandList: Record<Platform, Record<string, CommandItem[]>> = {
        unix: {
            Run: [
                {
                    title: t("install"),
                    command: `curl -fsSL https://static.pangolin.net/get-cli.sh | sudo bash`
                },
                {
                    title: t("run"),
                    command: `sudo pangolin up client --id ${id} --secret ${secret} --endpoint ${endpoint} --attach`
                }
            ],
            Service: [
                {
                    title: t("install"),
                    command: `curl -fsSL https://static.pangolin.net/get-cli.sh | bash`
                },
                {
                    title: t("run"),
                    command: `sudo pangolin service install client --id ${id} --secret ${secret} --endpoint ${endpoint}`
                },
                {
                    title: t("check"),
                    command: `sudo pangolin service status client`
                }
            ]
        },
        docker: {
            "Docker Compose": [
                `services:
  pangolin-cli:
    image: fosrl/pangolin-cli
    container_name: pangolin-cli
    restart: unless-stopped
    network_mode: host
    cap_add:
      - NET_ADMIN
    devices:
      - /dev/net/tun:/dev/net/tun
    environment:
      - PANGOLIN_ENDPOINT=${endpoint}
      - CLIENT_ID=${id}
      - CLIENT_SECRET=${secret}`
            ],
            "Docker Run": [
                `docker run -dit --network host --cap-add NET_ADMIN --device /dev/net/tun:/dev/net/tun fosrl/pangolin-cli up client --id ${id} --secret ${secret} --endpoint ${endpoint} --attach`
            ]
        },
        windows: {
            Run: [
                {
                    title: t("install"),
                    link: `https://github.com/fosrl/cli/releases/latest/download/pangolin-cli_windows_installer.msi`
                },
                {
                    title: t("run"),
                    command: `pangolin up client --id ${id} --secret ${secret} --endpoint ${endpoint}`
                }
            ],
            Service: [
                {
                    title: t("install"),
                    link: `https://github.com/fosrl/cli/releases/latest/download/pangolin-cli_windows_installer.msi`
                },
                {
                    title: t("run"),
                    command: `pangolin service install client --id ${id} --secret ${secret} --endpoint ${endpoint}`
                },
                {
                    title: t("check"),
                    command: `pangolin service status client`
                }
            ]
        }
    };

    const commands = commandList[platform][architecture];

    const platformOptions: OptionSelectOption<Platform>[] = PLATFORMS.map(
        (os) => ({
            value: os,
            label: getPlatformName(os),
            icon: getPlatformIcon(os)
        })
    );

    return (
        <SettingsSection>
            <SettingsSectionHeader>
                <SettingsSectionTitle>
                    {t("clientInstallOlm")}
                </SettingsSectionTitle>
                <SettingsSectionDescription>
                    {t("clientInstallOlmDescription")}
                </SettingsSectionDescription>
            </SettingsSectionHeader>
            <SettingsSectionBody>
                <OptionSelect<Platform>
                    label={t("operatingSystem")}
                    options={platformOptions}
                    value={platform}
                    onChange={(os) => {
                        setPlatform(os);
                        const architectures = getArchitectures(os);
                        setArchitecture(architectures[0]);
                    }}
                    cols={5}
                />

                <OptionSelect<string>
                    label={t("method")}
                    options={getArchitectures(platform).map((arch) => ({
                        value: arch,
                        label: arch
                    }))}
                    value={architecture}
                    onChange={setArchitecture}
                    cols={5}
                    className="mt-4"
                />

                <div className="pt-4">
                    <p className="font-semibold mb-3">{t("commands")}</p>
                    <div className="mt-2 space-y-3">
                        {commands.map((item, index) => {
                            const isLink =
                                typeof item !== "string" && "link" in item;
                            const commandText =
                                typeof item === "string"
                                    ? item
                                    : isLink
                                      ? undefined
                                      : item.command;
                            const linkHref = isLink
                                ? (item as { link: string }).link
                                : undefined;
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
                                    {isLink ? (
                                        <Button
                                            asChild
                                            variant="outline"
                                            className="w-full"
                                        >
                                            <a href={linkHref}>
                                                <Download className="h-4 w-4 mr-2" />
                                                {t("downloadInstaller")}
                                            </a>
                                        </Button>
                                    ) : (
                                        <CopyTextBox
                                            text={commandText!}
                                            outline={true}
                                        />
                                    )}
                                </div>
                            );
                        })}
                    </div>
                </div>
            </SettingsSectionBody>
        </SettingsSection>
    );
}

function getArchitectures(platform: Platform) {
    switch (platform) {
        case "unix":
            return ["Run", "Service"];
        case "windows":
            return ["Run", "Service"];
        case "docker":
            return ["Docker Compose", "Docker Run"];
        default:
            return ["Run"];
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
        default:
            return "Unix & macOS";
    }
}

function getPlatformIcon(platformName: Platform) {
    switch (platformName) {
        case "windows":
            return <FaWindows className="h-4 w-4 mr-2" />;
        case "unix":
            return <Terminal className="h-4 w-4 mr-2" />;
        case "docker":
            return <FaDocker className="h-4 w-4 mr-2" />;
        default:
            return <Terminal className="h-4 w-4 mr-2" />;
    }
}
