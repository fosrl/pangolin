This is tailscale's documentation:

Use Claude Code with Aperture
Last validated: Jul 24, 2026

Copy as Markdown
View as Markdown
Aperture by Tailscale is currently in beta.
Configure Claude Code to send requests through Aperture by Tailscale so your organization gets centralized API key management, usage tracking, and session logging.

The Aperture CLI can set up this connection for you automatically. It sets the environment variables Claude Code requires and launches it, so you can skip the manual steps below.

Prerequisites
Before you begin, you need:

An Aperture instance with at least one configured AI provider (such as Anthropic), accessible from your device. Refer to get started with Aperture if you have not set this up.
The Aperture host URL accessible from your device. Use http://, not https://.
Claude Code installed on your device.
To avoid unexpected TLS issues, use http:// for the Aperture URL when configuring LLM clients. All connections remain encrypted using WireGuard, even when HTTPS is not used.

Aperture routes requests based on the model name, not the LLM client. Any LLM client configured to use Aperture can access any provider your admin has set up. Refer to the provider compatibility reference for the full list of supported providers and API formats.

Configure Claude Code
To configure Claude Code to use Aperture, create or edit the global Claude Code settings file (~/.claude/settings.json) and set ANTHROPIC_BASE_URL to your Aperture URL:


{
  "apiKeyHelper": "echo '-'",
  "env": {
    "ANTHROPIC_BASE_URL": "http://<aperture-hostname>"
  }
}
The apiKeyHelper setting returns a placeholder value because Aperture injects credentials automatically. You do not need to configure an API key on the client.

To route a Claude subscription account such as Claude Pro or Max through Aperture, the upstream Anthropic provider must use passthrough mode so Aperture forwards Claude Code's own OAuth token to Anthropic. In this case, set only ANTHROPIC_BASE_URL and do not set ANTHROPIC_API_KEY or ANTHROPIC_AUTH_TOKEN. Setting either makes Claude Code send that value instead of its OAuth token, which suppresses the credential you want to pass through. For more information, refer to Set up passthrough mode.

You can also configure Claude Code using an environment variable instead of a settings file. Set the following environment variable:


export ANTHROPIC_BASE_URL="http://<aperture-hostname>"
Claude Code v1.x requires additional configuration because the apiKeyHelper setting does not exist in earlier versions. You must provide a placeholder authentication token and explicitly specify the model.


{
  "model": "claude-sonnet-4-6",
  "env": {
    "ANTHROPIC_AUTH_TOKEN": "bearer-managed",
    "ANTHROPIC_BASE_URL": "http://<aperture-hostname>"
  }
}
Claude Code with Amazon Bedrock
If your Aperture instance routes through Amazon Bedrock, use the following settings.json configuration instead of the default Anthropic configuration shown above:


{
  "env": {
    "ANTHROPIC_MODEL": "claude-sonnet-4-6",
    "ANTHROPIC_BEDROCK_BASE_URL": "http://<aperture-hostname>/bedrock",
    "CLAUDE_CODE_USE_BEDROCK": "1",
    "CLAUDE_CODE_SKIP_BEDROCK_AUTH": "1"
  }
}
If you use Claude Code in VS Code with Bedrock, also add "claudeCode.disableLoginPrompt": true to your VS Code user settings JSON (open the Command Palette and select Preferences: Open User Settings (JSON)).

Claude Code with Vertex AI
If your Aperture instance routes through Vertex AI, use the following settings.json configuration instead of the default Anthropic configuration. Replace <project-id> with your Google Cloud project ID.


{
  "env": {
    "CLOUD_ML_REGION": "global",
    "ANTHROPIC_VERTEX_PROJECT_ID": "<project-id>",
    "CLAUDE_CODE_USE_VERTEX": "1",
    "CLAUDE_CODE_SKIP_VERTEX_AUTH": "1",
    "ANTHROPIC_VERTEX_BASE_URL": "http://<aperture-hostname>/v1"
  }
}
If you use Claude Code in VS Code with Vertex, also add "claudeCode.disableLoginPrompt": true to your VS Code user settings JSON (open the Command Palette and select Preferences: Open User Settings (JSON)).

Verify the connection
To verify that Claude Code routes requests through Aperture:

Send a test message in Claude Code.
Open the Aperture dashboard at http://<aperture-hostname>/ui/ and confirm the request appears on the Logs page (admin only).
If the request does not appear, refer to the Aperture troubleshooting topic.

Next steps
Grant model access to users: Control which models each user or group can access through Aperture.
Review your usage dashboards: Monitor token consumption, costs, and session activity across your organization.
Set per-user spending limits: Configure quota buckets to control costs for individual users.
Use the Aperture CLI: Launch coding agents already configured for Aperture, without editing configuration by hand.

Use Codex with Aperture
Last validated: Jul 24, 2026

Copy as Markdown
View as Markdown
Aperture by Tailscale is currently in beta.
Configure Codex to send requests through Aperture by Tailscale so your organization gets centralized API key management, usage tracking, and session logging.

The Aperture CLI can set up this connection for you automatically. It writes the Codex configuration and launches it, so you can skip the manual steps below.

Prerequisites
Before you begin, you need:

An Aperture instance with at least one configured OpenAI-compatible provider, accessible from your device. Refer to get started with Aperture if you have not set this up.
The Aperture host URL accessible from your device. Use http://, not https://.
Codex installed on your device.
To avoid unexpected TLS issues, use http:// for the Aperture URL when configuring LLM clients. All connections remain encrypted using WireGuard, even when HTTPS is not used.

Aperture routes requests based on the model name, not the LLM client. Any LLM client configured to use Aperture can access any provider your admin has set up. Refer to the provider compatibility reference for the full list of supported providers and API formats.

Configure Codex
To configure Codex to use Aperture, create or edit the Codex configuration file (~/.codex/config.toml) to use the Aperture URL as the base_url and set the model to a Codex-compatible model:


model = "gpt-5.3-codex"
model_provider = "llm-ai-ts-net"
model_reasoning_effort = "high"

[
model_providers.llm-ai-ts-net
]
name = "Tailscale AI Gateway"
base_url = "http://<aperture-hostname>/v1" # Required: Aperture URL

# Required for Codex models
wire_api = "responses"
The wire_api = "responses" setting configures Codex to use the OpenAI Responses API format. You do not need to configure an API key because Aperture injects credentials automatically.

To forward each client's own credential instead of injecting a shared key, set the upstream provider to passthrough mode. Aperture then forwards the credential the client sends. A personal OpenAI platform API key uses the api.openai.com endpoint, while a ChatGPT subscription account such as Plus, Pro, or Team uses the ChatGPT backend endpoint and a different configuration. For more information, refer to Set up passthrough mode and Route a ChatGPT subscription through Aperture.

Verify the connection
Send a test message in Codex.
Open the Aperture dashboard at http://<aperture-hostname>/ui/ and confirm the request appears on the Logs page (admin only).
If the request does not appear, refer to the Aperture troubleshooting guide.

Use OpenCode with Aperture
Last validated: Jul 24, 2026

Copy as Markdown
View as Markdown
Aperture by Tailscale is currently in beta.
Configure OpenCode to send requests through Aperture by Tailscale so your organization gets centralized API key management, usage tracking, and session logging.

The Aperture CLI can set up this connection for you automatically. It writes the OpenCode configuration and launches it, so you can skip the manual steps below.

Prerequisites
Before you begin, you need:

An Aperture instance with at least one configured AI provider (such as Anthropic or OpenAI), accessible from your device. Refer to get started with Aperture if you have not set this up.
The Aperture host URL accessible from your device. Use http://, not https://.
OpenCode installed on your device.
To avoid unexpected TLS issues, use http:// for the Aperture URL when configuring LLM clients. All connections remain encrypted using WireGuard, even when HTTPS is not used.

Aperture routes requests based on the model name, not the LLM client. Any LLM client configured to use Aperture can access any provider your admin has set up. Refer to the provider compatibility reference for the full list of supported providers and API formats.

Configure OpenCode
OpenCode requires two configuration changes: set the base URL to point at Aperture, and provide a placeholder API key for each provider.

Set the base URL
Point OpenCode at your Aperture instance by setting the base URL for each provider in the OpenCode configuration file.

Open or create the OpenCode configuration file. The file is usually named opencode.json and located in your home directory or the directory where you run OpenCode. Refer to the OpenCode configuration documentation for details.

Add the following configuration to set Aperture as the base URL for your providers:


{
  "$schema": "https://opencode.ai/config.json",
  "provider": {
    "anthropic": {
      "options": {
        "baseURL": "http://<aperture-hostname>/v1"
      }
    },
    "openai": {
      "options": {
        "baseURL": "http://<aperture-hostname>/v1"
      }
    }
  }
}
Replace <aperture-hostname> with your Aperture hostname. If you connect from outside your tailnet, use http://localhost:<port-number> instead.

Include only the providers you have configured in Aperture. For example, if you only have Anthropic configured, omit the openai block.

Save the file.

Configure authentication
OpenCode requires an authentication entry for each provider. Set a placeholder value for each provider you configured.

Aperture identifies users through Tailscale identity and injects the real API credentials when forwarding requests. The placeholder value is never sent to the provider.

Open or create the OpenCode authentication file.

Add the following placeholder keys:


{
  "anthropic": {
    "type": "api",
    "key": "-"
  },
  "openai": {
    "type": "api",
    "key": "-"
  }
}
The dash character (-) satisfies OpenCode's authentication check.

Save the file.

Alternatively, enter the placeholder key interactively by running /connect inside OpenCode and selecting Manually enter an API Key for each provider.

Verify the connection
Send a test message in OpenCode.
Open the Aperture dashboard at http://<aperture-hostname>/ui/ and confirm the request appears on the Logs page (admin only).
If the request does not appear, refer to the Aperture troubleshooting guide.

This is netbird's documentation:

Keyless Access to Claude Code
Updated July 26, 2026

Point Claude Code at your agent network endpoint as its Anthropic base URL. NetBird holds the Anthropic API key server-side, so no key lives on your machine.

Running Claude Code through Agent Network turns it from a tool that needs a shared Anthropic key into one your team reaches with their existing identity:

Keyless access through your IdP. No Anthropic API key is distributed to or stored on any developer's machine. Each person runs Claude Code over the NetBird tunnel, and the request is tied to their real identity from your identity provider (Okta, Microsoft Entra ID, Google, …). Onboarding and offboarding follow the same IdP groups you already manage. There's no key to hand out, copy, or revoke.
Usage tracking per developer and group. Every request is metered by identity, model, tokens, and cost, so you can see exactly who is using Claude Code and how much it costs, broken down per person and aggregated per IdP group (team, department, project) in Usage & Logs.
Budget and token limits. Attach per-user or per-group token and spend caps over a rolling window in your policies, so Claude Code usage stays within budget and a single user can't run up the whole account's bill.
The rest of this page walks through connecting the provider and pointing Claude Code at your endpoint.

Connect the Provider
Go to Agent Network → Providers and click Connect Provider.
Select Anthropic and paste your Anthropic API key.
Save the provider. The key is now held server-side, the next step authorizes who can use it.
connect Anthropic provider in NetBird Agent Network

See Providers for details.

Create a Policy
By default nothing is allowed: a policy must connect a source group to the Anthropic provider before anyone can route Claude Code through it.

Go to Agent Network → Policies and add a policy.
Set the Source to the users or agents who should be able to use Claude Code (for example your Engineering group from your IdP).
Set the Provider to the Anthropic provider you just connected.
Optionally attach per-user or per-group token and budget limits so Claude Code usage stays within budget, and guardrails such as a model allowlist.
create a NetBird Agent Network policy authorizing Claude Code

See Policies for details.

Configure with settings.json
Next to your agent network endpoint in the NetBird dashboard, click Agent Config. The modal shows tabs for Claude Code, Codex, OpenAI SDK, and cURL. Pick Claude Code and copy the pre-filled configuration.

NetBird Configure Your Agent modal showing Claude Code settings.json configuration

Add the following to ~/.claude/settings.json. The apiKeyHelper returns a dummy value so Claude Code doesn't prompt for a key. NetBird supplies the real one.

{
  "apiKeyHelper": "echo '-'",
  "env": {
    "ANTHROPIC_BASE_URL": "https://<your-endpoint>"
  }
}

Copy
Copied!
Configure with Shell Variables
Alternatively, export the variables before launching Claude Code:

export ANTHROPIC_BASE_URL=https://<your-endpoint>
export ANTHROPIC_API_KEY=none
claude

Copy
Copied!
That's it. Claude Code now sends every request over the NetBird tunnel, where it's tied to your identity, checked against your policies and limits, and recorded in Usage & Logs, broken down per developer and aggregated per IdP group.

NetBird Agent Network access logs showing per-request Claude Code identity, group, model, cost, and status

Use Claude on Vertex AI
If you reach Claude through Google Vertex AI instead of the Anthropic API, point Claude Code's Vertex backend at your agent network endpoint. NetBird holds the Google service account credential server-side and mints the Vertex access token, so Claude Code skips Google authentication entirely. The client stays keyless.

First connect a Google Vertex AI provider in NetBird. Set its upstream URL to the region-less host https://aiplatform.googleapis.com, not the <region>-aiplatform.googleapis.com form, so it matches CLOUD_ML_REGION=global below.

Then add the following to ~/.claude/settings.json:

{
  "env": {
    "CLOUD_ML_REGION": "global",
    "ANTHROPIC_VERTEX_PROJECT_ID": "<your-gcp-project-id>",
    "CLAUDE_CODE_USE_VERTEX": "1",
    "CLAUDE_CODE_SKIP_VERTEX_AUTH": "1",
    "ANTHROPIC_VERTEX_BASE_URL": "https://<your-endpoint>/v1"
  }
}

Copy
Copied!
CLAUDE_CODE_USE_VERTEX=1 routes Claude Code through the Vertex backend.
CLAUDE_CODE_SKIP_VERTEX_AUTH=1 skips Google auth on the client: NetBird injects the OAuth token server-side.
ANTHROPIC_VERTEX_BASE_URL is your agent network endpoint with the /v1 suffix.
CLOUD_ML_REGION=global pairs with the region-less provider URL above.
Use Claude on AWS Bedrock
If you reach Claude through AWS Bedrock instead of the Anthropic API, point Claude Code's Bedrock backend at your agent network endpoint. NetBird holds the Bedrock API key server-side and injects it, so Claude Code skips AWS authentication entirely. The client stays keyless.

First connect an AWS Bedrock provider in NetBird. Then add the following to ~/.claude/settings.json:

{
  "env": {
    "ANTHROPIC_MODEL": "eu.anthropic.claude-sonnet-4-5-20250929-v1:0",
    "ANTHROPIC_BEDROCK_BASE_URL": "https://<your-endpoint>/bedrock",
    "CLAUDE_CODE_USE_BEDROCK": "1",
    "CLAUDE_CODE_SKIP_BEDROCK_AUTH": "1"
  }
}

Copy
Copied!
CLAUDE_CODE_USE_BEDROCK=1 routes Claude Code through the Bedrock backend.
CLAUDE_CODE_SKIP_BEDROCK_AUTH=1 skips AWS auth on the client: NetBird injects the Bedrock API key server-side.
ANTHROPIC_BEDROCK_BASE_URL is your agent network endpoint with the /bedrock suffix (the optional gateway-namespace prefix that disambiguates Bedrock from other providers).
ANTHROPIC_MODEL is the full Bedrock model ID including the region prefix (e.g. eu.anthropic.claude-sonnet-4-5-20250929-v1:0). Some models may not be available in all regions. If the model above doesn't work, switch to one in your provider's allowed list, or change it in Claude Code with /model <model-id>.
Use Kimi (Moonshot AI)
If you reach Claude through Moonshot AI instead of the Anthropic API, point Claude Code's Anthropic backend at your agent network endpoint. Moonshot serves the Anthropic Messages API under the /anthropic path, so Claude Code talks to the Kimi models through the same interface it uses for Claude. NetBird holds the Moonshot API key server-side and injects it, so the client stays keyless.

First connect a Kimi (Moonshot AI) provider in NetBird, keeping the default upstream URL https://api.moonshot.ai. Then add the following to ~/.claude/settings.json:

{
  "apiKeyHelper": "echo '-'",
  "env": {
    "ANTHROPIC_BASE_URL": "https://<your-endpoint>/anthropic",
    "ANTHROPIC_MODEL": "kimi-k3",
    "ANTHROPIC_DEFAULT_OPUS_MODEL": "kimi-k3",
    "ANTHROPIC_DEFAULT_SONNET_MODEL": "kimi-k3",
    "ANTHROPIC_DEFAULT_HAIKU_MODEL": "kimi-k3",
    "CLAUDE_CODE_SUBAGENT_MODEL": "kimi-k3",
    "ENABLE_TOOL_SEARCH": "false"
  }
}

Copy
Copied!
ANTHROPIC_BASE_URL is your agent network endpoint with the /anthropic suffix. That is the path Moonshot serves the Anthropic Messages API under, and NetBird rides it through to the bare https://api.moonshot.ai upstream.
The ANTHROPIC_DEFAULT_* and CLAUDE_CODE_SUBAGENT_MODEL variables pin every model tier (opus, sonnet, haiku, and subagents) to kimi-k3, so no Claude model names leak into requests Moonshot can't serve.
ENABLE_TOOL_SEARCH=false turns off tool search, whose tool_reference blocks Moonshot rejects.
In the Configure Your Agent modal, pick Kimi (Moonshot AI) on the Claude Code tab to copy this configuration with your endpoint filled in:

NetBird Configure Your Agent modal showing the Claude Code settings.json configuration for Kimi (Moonshot AI)

Keyless Access to Codex
Updated July 26, 2026

Configure Codex with a custom model provider that points at your agent network endpoint. NetBird injects the upstream key server-side, so the client stays keyless.

Running Codex through Agent Network turns it from a tool that needs a shared OpenAI key into one your team reaches with their existing identity:

Keyless access through your IdP. No OpenAI API key is distributed to or stored on any developer's machine. Each person runs Codex over the NetBird tunnel, and the request is tied to their real identity from your identity provider (Okta, Microsoft Entra ID, Google, …). Onboarding and offboarding follow the same IdP groups you already manage. There's no key to hand out, copy, or revoke.
Usage tracking per developer and group. Every request is metered by identity, model, tokens, and cost, so you can see exactly who is using Codex and how much it costs, broken down per person and aggregated per IdP group (team, department, project) in Usage & Logs.
Budget and token limits. Attach per-user or per-group token and spend caps over a rolling window in your policies, so Codex usage stays within budget and a single user can't run up the whole account's bill.
The rest of this page walks through connecting the provider and pointing Codex at your endpoint.

Connect the Provider
Go to Agent Network → Providers and click Connect Provider.
Select OpenAI (or another OpenAI-compatible provider or gateway) and paste its API key.
Save the provider. The key is now held server-side, the next step authorizes who can use it.
connect OpenAI provider in NetBird Agent Network

See Providers for details.

Create a Policy
By default nothing is allowed: a policy must connect a source group to the OpenAI provider before anyone can route Codex through it.

Go to Agent Network → Policies and add a policy.
Set the Source to the users or agents who should be able to use Codex (for example your Engineering group from your IdP).
Set the Provider to the OpenAI provider you just connected.
Optionally attach per-user or per-group token and budget limits so Codex usage stays within budget, and guardrails such as a model allowlist.
create a NetBird Agent Network policy authorizing Codex

See Policies for details.

Configure with config.toml
Add a model provider to ~/.codex/config.toml and select it as the default:

model_provider = "netbird"

[model_providers.netbird]
name = "NetBird"
base_url = "https://<your-endpoint>/v1"
wire_api = "responses"

Copy
Copied!
wire_api = "responses" tells Codex to use the OpenAI Responses API that it expects. The /v1 suffix is the OpenAI-compatible base path on your endpoint.

Once saved, Codex routes through NetBird, where each request is tied to your identity, evaluated against your policies and limits, and recorded in Usage & Logs.
