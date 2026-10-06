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
import { OptionSelect, type OptionSelectOption } from "./OptionSelect";
import { useState } from "react";
import {
    FaApple,
    FaCubes,
    FaDocker,
    FaHdd,
    FaLinux,
    FaWindows
} from "react-icons/fa";
import { Download, ExternalLink } from "lucide-react";
import { SiAlpinelinux, SiKubernetes, SiNixos } from "react-icons/si";
import { useEnvContext } from "@app/hooks/useEnvContext";

export type CommandItem =
    | string
    | { title: string; command: string }
    | { title: string; link: string };

const PLATFORMS = [
    "linux",
    "alpine",
    "macos",
    "docker",
    "kubernetes",
    "advantech",
    "podman",
    "nixos",
    "windows"
] as const;

type Platform = (typeof PLATFORMS)[number];

export type NewtSiteInstallCommandsProps = {
    id: string;
    secret: string;
    endpoint: string;
};

export function NewtSiteInstallCommands({
    id,
    secret,
    endpoint
}: NewtSiteInstallCommandsProps) {
    const t = useTranslations();
    const { env } = useEnvContext();

    const [acceptClients, setAcceptClients] = useState(true);
    const [allowPangolinSsh, setAllowPangolinSsh] = useState(
        !env.flags.disableEnterpriseFeatures
    );
    const [platform, setPlatform] = useState<Platform>("linux");
    const [architecture, setArchitecture] = useState(
        () => getArchitectures(platform)[0]
    );

    const showSiteConfiguration = platform !== "advantech";
    const supportsSshOption =
        platform === "linux" || platform === "nixos" || platform === "alpine";

    const acceptClientsFlag = !acceptClients ? " --disable-clients" : "";
    const acceptClientsEnv = !acceptClients
        ? "\n      - DISABLE_CLIENTS=true"
        : "";
    const acceptClientsHelmValue = acceptClients
        ? ` \\
      --set newtInstances[0].acceptClients=true`
        : "";

    const disableSshFlag =
        supportsSshOption &&
        !allowPangolinSsh &&
        !env.flags.disableEnterpriseFeatures
            ? " --disable-ssh"
            : "";
    const runAsRootPrefix =
        supportsSshOption && allowPangolinSsh ? "sudo " : "";

    const commandList: Record<Platform, Record<string, CommandItem[]>> = {
        linux: {
            Run: [
                {
                    title: t("install"),
                    command: `curl -fsSL https://static.pangolin.net/get-cli.sh | bash`
                },
                {
                    title: t("run"),
                    command: `${runAsRootPrefix}pangolin up site --id ${id} --secret ${secret} --endpoint ${endpoint}${acceptClientsFlag}${disableSshFlag}`
                }
            ],
            "Systemd Service": [
                {
                    title: t("install"),
                    command: `curl -fsSL https://static.pangolin.net/get-cli.sh | bash`
                },
                {
                    title: t("run"),
                    command: `sudo pangolin service install site --id ${id} --secret ${secret} --endpoint ${endpoint}${acceptClientsFlag}${disableSshFlag}`
                },
                {
                    title: t("check"),
                    command: `sudo pangolin service status site`
                }
            ],
            "Manual Systemd Service": [
                {
                    title: t("install"),
                    command: `curl -fsSL https://static.pangolin.net/get-cli.sh | bash`
                },
                {
                    title: t("envFile"),
                    command: `# Create the directory and environment file
sudo install -d -m 0755 /etc/pangolin
sudo tee /etc/pangolin/pangolin-site.env > /dev/null << 'EOF'
SITE_ID=${id}
SITE_SECRET=${secret}
PANGOLIN_ENDPOINT=${endpoint}${
                        !acceptClients
                            ? `
DISABLE_CLIENTS=true`
                            : ""
                    }${
                        !allowPangolinSsh
                            ? `
DISABLE_SSH=true`
                            : ""
                    }
EOF
sudo chmod 600 /etc/pangolin/pangolin-site.env`
                },
                {
                    title: t("serviceFile"),
                    command: `sudo tee /etc/systemd/system/pangolin-site.service > /dev/null << 'EOF'
[Unit]
Description=Pangolin Site
Wants=network-online.target
After=network-online.target

[Service]
Type=simple
User=root
Group=root
EnvironmentFile=/etc/pangolin/pangolin-site.env
ExecStart=/usr/local/bin/pangolin up site
Restart=always
RestartSec=2
UMask=0077

PrivateTmp=true

[Install]
WantedBy=multi-user.target
EOF`
                },
                {
                    title: t("enableAndStart"),
                    command: `sudo systemctl daemon-reload
sudo systemctl enable --now pangolin-site`
                }
            ]
        },
        alpine: {
            Run: [
                {
                    title: t("install"),
                    command: `curl -fsSL https://static.pangolin.net/get-cli.sh | bash`
                },
                {
                    title: t("run"),
                    command: `${runAsRootPrefix}pangolin up site --id ${id} --secret ${secret} --endpoint ${endpoint}${acceptClientsFlag}${disableSshFlag}`
                }
            ],
            "Manual OpenRC Service": [
                {
                    title: t("install"),
                    command: `curl -fsSL https://static.pangolin.net/get-cli.sh | bash`
                },
                {
                    title: t("envFile"),
                    command: `sudo tee /etc/conf.d/pangolin-site > /dev/null << 'EOF'
export SITE_ID=${id}
export SITE_SECRET=${secret}
export PANGOLIN_ENDPOINT=${endpoint}${
                        !acceptClients
                            ? `
export DISABLE_CLIENTS=true`
                            : ""
                    }${
                        !allowPangolinSsh
                            ? `
export DISABLE_SSH=true`
                            : ""
                    }
EOF
sudo chmod 600 /etc/conf.d/pangolin-site`
                },
                {
                    title: t("serviceFile"),
                    command: `sudo tee /etc/init.d/pangolin-site > /dev/null << 'EOF'
#!/sbin/openrc-run

name="pangolin-site"
description="Pangolin Site"

command="/usr/local/bin/pangolin"
command_args="up site"
command_background="yes"
supervisor="supervise-daemon"

pidfile="/run/pangolin-site.pid"
output_log="/var/log/pangolin-site.log"
error_log="/var/log/pangolin-site.err"

depend() {
    need net
    after firewall
}
EOF
sudo chmod +x /etc/init.d/pangolin-site`
                },
                {
                    title: t("enableAndStart"),
                    command: `sudo rc-update add pangolin-site default
sudo rc-service pangolin-site start`
                },
                {
                    title: t("check"),
                    command: `sudo rc-service pangolin-site status`
                }
            ]
        },
        macos: {
            Run: [
                {
                    title: t("install"),
                    command: `curl -fsSL https://static.pangolin.net/get-cli.sh | bash`
                },
                {
                    title: t("run"),
                    command: `pangolin up site --id ${id} --secret ${secret} --endpoint ${endpoint}${acceptClientsFlag}`
                }
            ],
            Service: [
                {
                    title: t("install"),
                    command: `curl -fsSL https://static.pangolin.net/get-cli.sh | bash`
                },
                {
                    title: t("run"),
                    command: `sudo pangolin service install site --id ${id} --secret ${secret} --endpoint ${endpoint}${acceptClientsFlag}${disableSshFlag}`
                },
                {
                    title: t("check"),
                    command: `sudo pangolin service status site`
                }
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
                    command: `pangolin up site --id ${id} --secret ${secret} --endpoint ${endpoint}${acceptClientsFlag}`
                }
            ],
            Service: [
                {
                    title: t("install"),
                    link: `https://github.com/fosrl/cli/releases/latest/download/pangolin-cli_windows_installer.msi`
                },
                {
                    title: t("run"),
                    command: `pangolin service install site --id ${id} --secret ${secret} --endpoint ${endpoint}${acceptClientsFlag}${disableSshFlag}`
                },
                {
                    title: t("check"),
                    command: `pangolin service status site`
                }
            ]
        },
        docker: {
            "Docker Compose": [
                `services:
  pangolin-site:
    image: fosrl/pangolin-cli
    container_name: pangolin-site
    restart: unless-stopped
    environment:
      - PANGOLIN_ENDPOINT=${endpoint}
      - SITE_ID=${id}
      - SITE_SECRET=${secret}${acceptClientsEnv}`
            ],
            "Docker Run": [
                `docker run -dit --network host fosrl/pangolin-cli up site --id ${id} --secret ${secret} --endpoint ${endpoint}${acceptClientsFlag}`
            ]
        },
        kubernetes: {
            // we are leaving this using newt until we change it to use the cli
            "Helm Chart": [
                `helm repo add fossorial https://charts.fossorial.io`,
                `helm repo update fossorial`,
                `kubectl create namespace newt --dry-run=client -o yaml | kubectl apply -f -`,
                `kubectl create secret generic newt-main-tunnel-auth \\
   -n newt \\
  --from-literal=PANGOLIN_ENDPOINT="${endpoint}" \\
  --from-literal=NEWT_ID="${id}" \\
  --from-literal=NEWT_SECRET="${secret}" \\
  --dry-run=client -o yaml | kubectl apply -f -`,
                `helm upgrade --install newt fossorial/newt \\
  -n newt \\
  --set newtInstances[0].name="main-tunnel" \\
  --set newtInstances[0].enabled=true \\
  --set-string newtInstances[0].auth.existingSecretName="newt-main-tunnel-auth"${acceptClientsHelmValue}`
            ]
        },
        advantech: {
            Documentation: []
        },
        podman: {
            "Podman Quadlet": [
                `[Unit]
Description=Pangolin Site Container

[Container]
ContainerName=pangolin-site
Image=docker.io/fosrl/pangolin-cli
Environment=PANGOLIN_ENDPOINT=${endpoint}
Environment=SITE_ID=${id}
Environment=SITE_SECRET=${secret}${!acceptClients ? "\nEnvironment=DISABLE_CLIENTS=true" : ""}
# Secret=pangolin-secret,type=env,target=SITE_SECRET

[Service]
Restart=always

[Install]
WantedBy=default.target`
            ],
            "Podman Run": [
                `podman run -dit docker.io/fosrl/pangolin-cli up site --id ${id} --secret ${secret} --endpoint ${endpoint}${acceptClientsFlag}`
            ]
        },
        nixos: {
            Flake: [
                `${runAsRootPrefix}nix run 'nixpkgs#pangolin-cli' -- up site --id ${id} --secret ${secret} --endpoint ${endpoint}${acceptClientsFlag}${disableSshFlag}`
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
                    {t("siteInstallNewt")}
                </SettingsSectionTitle>
                <SettingsSectionDescription>
                    {t("siteInstallNewtDescription")}
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

                {showSiteConfiguration && (
                    <div className="pt-4">
                        <p className="font-semibold mb-3">
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
                        {supportsSshOption &&
                            !env.flags.disableEnterpriseFeatures && (
                                <>
                                    <div className="flex items-center space-x-2 mb-2 mt-2">
                                        <CheckboxWithLabel
                                            id="allowPangolinSsh"
                                            checked={allowPangolinSsh}
                                            onCheckedChange={(checked) => {
                                                const value =
                                                    checked as boolean;
                                                setAllowPangolinSsh(value);
                                            }}
                                            label="Allow Pangolin SSH"
                                        />
                                    </div>
                                    <p
                                        id="allowPangolinSsh-desc"
                                        className="text-sm text-muted-foreground"
                                    >
                                        {t("sitePangolinSshDescription")}
                                    </p>
                                </>
                            )}
                    </div>
                )}

                <div className="pt-4">
                    <p className="font-semibold mb-3">{t("commands")}</p>
                    {platform === "kubernetes" && (
                        <p className="text-sm text-muted-foreground mb-3">
                            {t.rich("siteInstallKubernetesDocsDescription", {
                                docsLink: (chunks) => (
                                    <a
                                        href="https://docs.pangolin.net/manage/sites/install-kubernetes"
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="text-primary hover:underline inline-flex items-center gap-1"
                                    >
                                        {chunks}
                                        <ExternalLink className="size-3.5 shrink-0" />
                                    </a>
                                )
                            })}
                        </p>
                    )}
                    {platform === "advantech" && (
                        <p className="text-sm text-muted-foreground mb-3">
                            {t.rich("siteInstallAdvantechDocsDescription", {
                                docsLink: (chunks) => (
                                    <a
                                        href="https://docs.pangolin.net/manage/sites/install-site"
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="text-primary hover:underline inline-flex items-center gap-1"
                                    >
                                        {chunks}
                                        <ExternalLink className="size-3.5 shrink-0" />
                                    </a>
                                )
                            })}
                        </p>
                    )}
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

                            const key = `${title ?? ""}::${commandText ?? linkHref}`;

                            return (
                                <div key={key}>
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

function getPlatformIcon(platformName: Platform) {
    switch (platformName) {
        case "windows":
            return <FaWindows className="h-4 w-4 mr-2" />;
        case "linux":
            return <FaLinux className="h-4 w-4 mr-2" />;
        case "alpine":
            return <SiAlpinelinux className="h-4 w-4 mr-2" />;
        case "macos":
            return <FaApple className="h-4 w-4 mr-2" />;
        case "docker":
            return <FaDocker className="h-4 w-4 mr-2" />;
        case "kubernetes":
            return <SiKubernetes className="h-4 w-4 mr-2" />;
        case "advantech":
            return <FaHdd className="h-4 w-4 mr-2" />;
        case "podman":
            return <FaCubes className="h-4 w-4 mr-2" />;
        case "nixos":
            return <SiNixos className="h-4 w-4 mr-2" />;
        default:
            return <FaLinux className="h-4 w-4 mr-2" />;
    }
}

function getPlatformName(platformName: Platform) {
    switch (platformName) {
        case "windows":
            return "Windows";
        case "linux":
            return "Linux";
        case "alpine":
            return "Alpine Linux";
        case "macos":
            return "macOS";
        case "docker":
            return "Docker";
        case "kubernetes":
            return "Kubernetes";
        case "advantech":
            return "Advantech";
        case "podman":
            return "Podman";
        case "nixos":
            return "NixOS";
        default:
            return "Linux";
    }
}

function getArchitectures(platform: Platform) {
    switch (platform) {
        case "linux":
            return ["Run", "Systemd Service", "Manual Systemd Service"];
        case "alpine":
            return ["Run", "Manual OpenRC Service"];
        case "macos":
            return ["Run", "Service"];
        case "windows":
            return ["Run", "Service"];
        case "docker":
            return ["Docker Compose", "Docker Run"];
        case "kubernetes":
            return ["Helm Chart"];
        case "advantech":
            return ["Documentation"];
        case "podman":
            return ["Podman Quadlet", "Podman Run"];
        case "nixos":
            return ["Flake"];
        default:
            return ["Run"];
    }
}
