import { OpenAPIRegistry } from "@asteasolutions/zod-to-openapi";

export const registry = new OpenAPIRegistry();

export enum OpenAPITags {
    Site = "Site",
    Org = "Organization",
    PublicResource = "Public Resource",
    PrivateResource = "Private Resource",
    Policy = "Policy",
    Role = "Role",
    User = "User",
    Invitation = "User Invitation",
    Target = "Resource Target",
    Rule = "Rule",
    AccessToken = "Access Token",
    GlobalIdp = "Identity Provider (Global)",
    OrgIdp = "Identity Provider (Organization Only)",
    Client = "Client",
    ApiKey = "API Key",
    Domain = "Domain",
    Blueprint = "Blueprint",
    Ssh = "SSH",
    Logs = "Logs"
}
