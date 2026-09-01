import { db, resources, users, virtualApiKeyResources } from "@server/db";
import { and, asc, eq } from "drizzle-orm";
import config from "@server/lib/config";
import { sendEmail } from "@server/emails";
import IdentityApiKeyGenerated from "@server/emails/templates/IdentityApiKeyGenerated";
import VirtualApiKeyGenerated from "@server/emails/templates/VirtualApiKeyGenerated";
import { formatVirtualApiKeyCredential } from "@server/lib/virtualApiKey";

const EMAIL_GATEWAY_URL_LIMIT = 5;
const VIRTUAL_API_KEY_EMAIL_BATCH_SIZE = 50;

export async function mapInBatches<T>(
    items: T[],
    fn: (item: T) => Promise<void>,
    batchSize = VIRTUAL_API_KEY_EMAIL_BATCH_SIZE
): Promise<void> {
    for (let i = 0; i < items.length; i += batchSize) {
        const batch = items.slice(i, i + batchSize);
        await Promise.all(batch.map(fn));
    }
}

async function listVirtualApiKeyGatewayUrls(params: {
    orgId: string;
    allResources: boolean;
    virtualApiKeyId: string;
}): Promise<{ urls: string[]; hasMore: boolean }> {
    const rows = params.allResources
        ? await db
              .select({
                  fullDomain: resources.fullDomain,
                  ssl: resources.ssl
              })
              .from(resources)
              .where(
                  and(
                      eq(resources.orgId, params.orgId),
                      eq(resources.mode, "inference")
                  )
              )
              .orderBy(asc(resources.name))
              .limit(EMAIL_GATEWAY_URL_LIMIT + 1)
        : await db
              .select({
                  fullDomain: resources.fullDomain,
                  ssl: resources.ssl
              })
              .from(virtualApiKeyResources)
              .innerJoin(
                  resources,
                  eq(virtualApiKeyResources.resourceId, resources.resourceId)
              )
              .where(
                  eq(
                      virtualApiKeyResources.virtualApiKeyId,
                      params.virtualApiKeyId
                  )
              )
              .orderBy(asc(resources.name))
              .limit(EMAIL_GATEWAY_URL_LIMIT + 1);

    const urls = rows
        .map((row) =>
            row.fullDomain
                ? `${row.ssl ? "https" : "http"}://${row.fullDomain}`
                : null
        )
        .filter((url): url is string => Boolean(url));

    return {
        urls: urls.slice(0, EMAIL_GATEWAY_URL_LIMIT),
        hasMore: rows.length > EMAIL_GATEWAY_URL_LIMIT
    };
}

export async function listOrgInferenceGatewayUrls(orgId: string): Promise<{
    urls: string[];
    hasMore: boolean;
}> {
    return listVirtualApiKeyGatewayUrls({
        orgId,
        allResources: true,
        virtualApiKeyId: ""
    });
}

export async function resolveVirtualApiKeyEmailRecipients(params: {
    sendEmail: boolean;
    sendToAttributedUser: boolean;
    userId: string | null | undefined;
    emails: string[];
}): Promise<
    { ok: true; recipients: string[] } | { ok: false; message: string }
> {
    if (!params.sendEmail) {
        return { ok: true, recipients: [] };
    }

    if (!config.getRawConfig().email) {
        return {
            ok: false,
            message: "Email is not configured on this server"
        };
    }

    const recipients = new Set(
        params.emails.map((email) => email.trim().toLowerCase()).filter(Boolean)
    );

    if (params.sendToAttributedUser) {
        if (!params.userId) {
            return {
                ok: false,
                message: "Associate a user to email the key to that user"
            };
        }

        const [user] = await db
            .select({ email: users.email })
            .from(users)
            .where(eq(users.userId, params.userId))
            .limit(1);

        if (!user?.email) {
            return {
                ok: false,
                message: "The associated user does not have an email address"
            };
        }

        recipients.add(user.email.toLowerCase());
    }

    if (recipients.size === 0) {
        return {
            ok: false,
            message: "Select at least one email recipient"
        };
    }

    return { ok: true, recipients: [...recipients] };
}

export async function sendVirtualApiKeyEmails(params: {
    recipients: string[];
    orgName: string;
    orgId: string;
    keyName: string | null;
    virtualApiKeyId: string;
    secret: string;
    allResources: boolean;
    isIdentityKey?: boolean;
    accountLabel?: string | null;
    gatewayUrls?: { urls: string[]; hasMore: boolean };
}): Promise<void> {
    if (params.recipients.length === 0) {
        return;
    }

    const credential = formatVirtualApiKeyCredential(
        params.virtualApiKeyId,
        params.secret
    );
    const { urls, hasMore } =
        params.gatewayUrls ??
        (await listVirtualApiKeyGatewayUrls({
            orgId: params.orgId,
            allResources: params.allResources,
            virtualApiKeyId: params.virtualApiKeyId
        }));
    const from = config.getNoReplyEmail();
    const subject = params.isIdentityKey
        ? `Your identity key for ${params.orgName}`
        : `Virtual API key for ${params.orgName}`;

    await mapInBatches(params.recipients, async (to) => {
        await sendEmail(
            params.isIdentityKey
                ? IdentityApiKeyGenerated({
                      orgName: params.orgName,
                      accountLabel: params.accountLabel,
                      credential,
                      resourceUrls: urls,
                      hasMoreResources: hasMore
                  })
                : VirtualApiKeyGenerated({
                      orgName: params.orgName,
                      keyName: params.keyName,
                      credential,
                      resourceUrls: urls,
                      hasMoreResources: hasMore
                  }),
            {
                to,
                from,
                subject
            }
        );
    });
}
