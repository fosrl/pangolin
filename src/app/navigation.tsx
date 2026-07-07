import { SidebarNavItem } from "@app/components/SidebarNav";
import { Env } from "@app/lib/types/env";
import { build } from "@server/build";
import {
    BellRing,
    Boxes,
    Building2,
    Cable,
    ChartLine,
    Combine,
    CreditCard,
    Fingerprint,
    Globe,
    GlobeIcon,
    GlobeLock,
    KeyRound,
    Laptop,
    Link as LinkIcon,
    Logs,
    MonitorUp,
    Plug,
    ReceiptText,
    ScanEye,
    Server,
    Settings,
    ShieldIcon,
    SquareMousePointer,
    TagIcon,
    TicketCheck,
    Unplug,
    User,
    UserCog,
    Users,
    Waypoints
} from "lucide-react";

export type SidebarNavSection = {
    // Added from 'dev' branch
    heading: string;
    items: SidebarNavItem[];
};

export type OrgNavSectionsOptions = {
    isPrimaryOrg?: boolean;
};

// Merged from 'user-management-and-resources' branch
export const orgLangingNavItems: SidebarNavItem[] = [
    {
        title: "sidebarAccount",
        href: "/{orgId}",
        icon: <User className="size-4 flex-none" />
    }
];

export const orgNavSections = (
    env?: Env,
    options?: OrgNavSectionsOptions
): SidebarNavSection[] => [
    {
        heading: "network",
        items: [
            {
                title: "sidebarSites",
                href: "/{orgId}/settings/sites",
                icon: <Plug className="size-4 flex-none" />
            },
            {
                title: "sidebarResources",
                icon: <Waypoints className="size-4 flex-none" />,
                items: [
                    {
                        title: "sidebarProxyResources",
                        href: "/{orgId}/settings/resources/public",
                        icon: <Globe className="size-4 flex-none" />
                    },
                    {
                        title: "sidebarClientResources",
                        href: "/{orgId}/settings/resources/private",
                        icon: <GlobeLock className="size-4 flex-none" />
                    }
                ]
            },
            {
                title: "sidebarClients",
                icon: <MonitorUp className="size-4 flex-none" />,
                items: [
                    {
                        href: "/{orgId}/settings/clients/user",
                        title: "sidebarUserDevices",
                        icon: <Laptop className="size-4 flex-none" />
                    },
                    {
                        href: "/{orgId}/settings/clients/machine",
                        title: "sidebarMachineClients",
                        icon: <Server className="size-4 flex-none" />
                    }
                ]
            },
            {
                title: "sidebarDomains",
                href: "/{orgId}/settings/domains",
                icon: <Globe className="size-4 flex-none" />
            },
            ...(build === "saas"
                ? [
                      {
                          title: "sidebarRemoteExitNodes",
                          href: "/{orgId}/settings/remote-exit-nodes",
                          icon: <Server className="size-4 flex-none" />
                      }
                  ]
                : [])
        ]
    },
    {
        heading: "accessControl",
        items: [
            {
                title: "sidebarTeam",
                icon: <Users className="size-4 flex-none" />,
                items: [
                    {
                        title: "sidebarUsers",
                        href: "/{orgId}/settings/access/users",
                        icon: <User className="size-4 flex-none" />
                    },
                    {
                        title: "sidebarRoles",
                        href: "/{orgId}/settings/access/roles",
                        icon: <Users className="size-4 flex-none" />
                    },
                    {
                        title: "sidebarInvitations",
                        href: "/{orgId}/settings/access/invitations",
                        icon: <TicketCheck className="size-4 flex-none" />
                    }
                ]
            },
            ...(!env?.flags.disableEnterpriseFeatures
                ? [
                      {
                          title: "sidebarPolicies",

                          icon: <ShieldIcon className="size-4 flex-none" />,
                          items: [
                              {
                                  title: "sidebarResourcePolicies",
                                  href: "/{orgId}/settings/policies/resources/public",
                                  icon: (
                                      <GlobeIcon className="size-4 flex-none" />
                                  )
                              }
                          ]
                      }
                  ]
                : []),
            // PaidFeaturesAlert
            ...(!env?.flags.disableEnterpriseFeatures &&
            (build === "saas" ||
                env?.app.identityProviderMode === "org" ||
                (env?.app.identityProviderMode === undefined &&
                    build !== "oss"))
                ? [
                      {
                          title: "sidebarIdentityProviders",
                          href: "/{orgId}/settings/idp",
                          icon: <Fingerprint className="size-4 flex-none" />
                      }
                  ]
                : []),
            ...(!env?.flags.disableEnterpriseFeatures
                ? [
                      {
                          title: "sidebarApprovals",
                          href: "/{orgId}/settings/access/approvals",
                          icon: <UserCog className="size-4 flex-none" />
                      }
                  ]
                : []),
            {
                title: "sidebarShareableLinks",
                href: "/{orgId}/settings/share-links",
                icon: <LinkIcon className="size-4 flex-none" />
            }
        ]
    },
    {
        heading: "sidebarOrganization",
        items: [
            {
                title: "sidebarLogsAndAnalytics",
                icon: <ChartLine className="size-4 flex-none" />,
                items: [
                    {
                        title: "sidebarLogsAnalytics",
                        href: "/{orgId}/settings/logs/analytics",
                        icon: <ChartLine className="size-4 flex-none" />
                    },
                    {
                        title: "sidebarLogsRequest",
                        href: "/{orgId}/settings/logs/request",
                        icon: (
                            <SquareMousePointer className="size-4 flex-none" />
                        )
                    },
                    ...(!env?.flags.disableEnterpriseFeatures
                        ? [
                              {
                                  title: "sidebarLogsAccess",
                                  href: "/{orgId}/settings/logs/access",
                                  icon: <ScanEye className="size-4 flex-none" />
                              },
                              {
                                  title: "sidebarLogsAction",
                                  href: "/{orgId}/settings/logs/action",
                                  icon: <Logs className="size-4 flex-none" />
                              },
                              {
                                  title: "sidebarLogsConnection",
                                  href: "/{orgId}/settings/logs/connection",
                                  icon: <Cable className="size-4 flex-none" />
                              },
                              {
                                  title: "sidebarLogsStreaming",
                                  href: "/{orgId}/settings/logs/streaming",
                                  icon: <Unplug className="size-4 flex-none" />
                              }
                          ]
                        : [])
                ]
            },
            {
                title: "sidebarManagement",
                icon: <Building2 className="size-4 flex-none" />,
                items: [
                    ...(!env?.flags.disableEnterpriseFeatures
                        ? [
                              {
                                  title: "sidebarAlerting",
                                  href: "/{orgId}/settings/alerting",
                                  icon: (
                                      <BellRing className="size-4 flex-none" />
                                  )
                              },
                              {
                                  title: "sidebarProvisioning",
                                  href: "/{orgId}/settings/provisioning",
                                  icon: <Boxes className="size-4 flex-none" />
                              }
                          ]
                        : []),
                    {
                        title: "sidebarBluePrints",
                        href: "/{orgId}/settings/blueprints",
                        icon: <ReceiptText className="size-4 flex-none" />
                    },
                    {
                        title: "sidebarApiKeys",
                        href: "/{orgId}/settings/api-keys",
                        icon: <KeyRound className="size-4 flex-none" />
                    },
                    ...(!env?.flags.disableEnterpriseFeatures
                        ? [
                              {
                                  title: "labels",
                                  href: "/{orgId}/settings/labels",
                                  icon: <TagIcon className="size-4 flex-none" />
                              }
                          ]
                        : [])
                ]
            },
            ...(build === "saas" && options?.isPrimaryOrg
                ? [
                      {
                          title: "sidebarBillingAndLicenses",
                          icon: <CreditCard className="size-4 flex-none" />,
                          items: [
                              {
                                  title: "sidebarBilling",
                                  href: "/{orgId}/settings/billing",
                                  icon: (
                                      <CreditCard className="size-4 flex-none" />
                                  )
                              },
                              {
                                  title: "sidebarEnterpriseLicenses",
                                  href: "/{orgId}/settings/license",
                                  icon: (
                                      <TicketCheck className="size-4 flex-none" />
                                  )
                              }
                          ]
                      }
                  ]
                : []),
            {
                title: "sidebarSettings",
                href: "/{orgId}/settings/general",
                icon: <Settings className="size-4 flex-none" />
            }
        ]
    }
];

export const adminNavSections = (env?: Env): SidebarNavSection[] => [
    {
        heading: "sidebarAdmin",
        items: [
            {
                title: "sidebarAllUsers",
                href: "/admin/users",
                icon: <Users className="size-4 flex-none" />
            },
            {
                title: "sidebarApiKeys",
                href: "/admin/api-keys",
                icon: <KeyRound className="size-4 flex-none" />
            },
            ...(build === "oss" ||
            env?.app.identityProviderMode === "global" ||
            env?.app.identityProviderMode === undefined
                ? [
                      {
                          title: "sidebarIdentityProviders",
                          href: "/admin/idp",
                          icon: <Fingerprint className="size-4 flex-none" />
                      }
                  ]
                : []),
            ...(build == "enterprise"
                ? [
                      {
                          title: "sidebarLicense",
                          href: "/admin/license",
                          icon: <TicketCheck className="size-4 flex-none" />
                      }
                  ]
                : [])
        ]
    }
];
