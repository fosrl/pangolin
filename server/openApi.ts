import { OpenAPIRegistry } from "@asteasolutions/zod-to-openapi";

export const registry = new OpenAPIRegistry();

export enum OpenAPITags {
    Site = "Site",
    PublicResource = "Public Resource",
    Target = "Resource Target",
    PrivateResource = "Private Resource",
    Client = "Client",
    Org = "Organization",
    Domain = "Domain",
    PublicResourcePolicy = "Public Resource Policy",
    Role = "Role",
    User = "User",
    Rule = "Rule",
    Invitation = "User Invitation",
    AccessToken = "Access Token",
    GlobalIdp = "Identity Provider (Global)",
    OrgIdp = "Identity Provider (Organization Only)",
    ApiKey = "API Key",
    SiteProvisioningKey = "Site Provisioning Key",
    Blueprint = "Blueprint",
    Ssh = "SSH",
    Logs = "Logs",
    EventStreamingDestination = "Event Streaming Destination",
    AlertRule = "Alert Rule",
    HealthCheck = "Health Check",
    PublicResourcePolicyLegacy = "Public Resource Policy (Legacy)",
    PublicResourceLegacy = "Public Resource (Legacy)",
    PrivateResourceLegacy = "Private Resource (Legacy)",
    AiProvider = "AI Provider",
    AiModel = "AI Model",
    AiBudget = "AI Budget",
    VirtualApiKey = "Virtual API Key"
}

// Order here controls the order tags are displayed in Swagger UI
export const openApiTags = Object.values(OpenAPITags).map((name) => ({
    name
}));
