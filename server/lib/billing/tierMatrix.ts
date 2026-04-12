import { Tier } from "@server/types/Tiers";

export enum TierFeature {
    OrgOidc = "orgOidc",
    LoginPageDomain = "loginPageDomain", // handle downgrade by removing custom domain
    DeviceApprovals = "deviceApprovals", // handle downgrade by disabling device approvals
    LoginPageBranding = "loginPageBranding", // handle downgrade by setting to default branding
    LogExport = "logExport",
    AccessLogs = "accessLogs", // set the retention period to none on downgrade
    ActionLogs = "actionLogs", // set the retention period to none on downgrade
    ConnectionLogs = "connectionLogs",
    RotateCredentials = "rotateCredentials",
    MaintencePage = "maintencePage", // handle downgrade
    DevicePosture = "devicePosture",
    TwoFactorEnforcement = "twoFactorEnforcement", // handle downgrade by setting to optional
    SessionDurationPolicies = "sessionDurationPolicies", // handle downgrade by setting to default duration
    PasswordExpirationPolicies = "passwordExpirationPolicies", // handle downgrade by setting to default duration
    AutoProvisioning = "autoProvisioning", // handle downgrade by disabling auto provisioning
    SshPam = "sshPam",
    FullRbac = "fullRbac",
    SiteProvisioningKeys = "siteProvisioningKeys", // handle downgrade by revoking keys if needed
    SIEM = "siem", // handle downgrade by disabling SIEM integrations
    DomainNamespaces = "domainNamespaces" // handle downgrade by removing custom domain namespaces
}

export const tierMatrix: Record<TierFeature, Tier[]> = {
    [TierFeature.OrgOidc]: ["tier1", "tier2", "tier3", "enterprise"],
    [TierFeature.LoginPageDomain]: ["tier1", "tier2", "tier3", "enterprise"],
    [TierFeature.DeviceApprovals]: ["tier1", "tier3", "enterprise"],
    [TierFeature.LoginPageBranding]: ["tier1", "tier3", "enterprise"],
    [TierFeature.LogExport]: ["tier3", "enterprise"],
    [TierFeature.AccessLogs]: ["tier2", "tier3", "enterprise"],
    [TierFeature.ActionLogs]: ["tier2", "tier3", "enterprise"],
    [TierFeature.ConnectionLogs]: ["tier2", "tier3", "enterprise"],
    [TierFeature.RotateCredentials]: ["tier1", "tier2", "tier3", "enterprise"],
    [TierFeature.MaintencePage]: ["tier1", "tier2", "tier3", "enterprise"],
    [TierFeature.DevicePosture]: ["tier2", "tier3", "enterprise"],
    [TierFeature.TwoFactorEnforcement]: [
        "tier1",
        "tier2",
        "tier3",
        "enterprise"
    ],
    [TierFeature.SessionDurationPolicies]: [
        "tier1",
        "tier2",
        "tier3",
        "enterprise"
    ],
    [TierFeature.PasswordExpirationPolicies]: [
        "tier1",
        "tier2",
        "tier3",
        "enterprise"
    ],
    [TierFeature.AutoProvisioning]: ["tier1", "tier3", "enterprise"],
    [TierFeature.SshPam]: ["tier1", "tier3", "enterprise"],
    [TierFeature.FullRbac]: ["tier1", "tier2", "tier3", "enterprise"],
    [TierFeature.SiteProvisioningKeys]: ["tier3", "enterprise"],
    [TierFeature.SIEM]: ["enterprise"],
    [TierFeature.DomainNamespaces]: ["tier1", "tier2", "tier3", "enterprise"]
};
