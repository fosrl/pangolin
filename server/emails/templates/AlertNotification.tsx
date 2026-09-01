import React from "react";
import { Body, Head, Html, Preview, Tailwind } from "@react-email/components";
import { themeColors } from "./lib/theme";
import {
    EmailContainer,
    EmailFooter,
    EmailGreeting,
    EmailHeading,
    EmailInfoSection,
    EmailLetterHead,
    EmailSection,
    EmailSignature,
    EmailText
} from "./components/Email";
import ButtonLink from "./components/ButtonLink";

export type AlertEventType =
    | "site_online"
    | "site_offline"
    | "site_toggle"
    | "health_check_healthy"
    | "health_check_unhealthy"
    | "health_check_toggle"
    | "resource_healthy"
    | "resource_unhealthy"
    | "resource_degraded"
    | "resource_toggle";

export type AlertNotificationProps = {
    eventType: AlertEventType;
    orgId: string;
    data: Record<string, unknown>;
    dashboardLink: string;
    isTestAlert?: boolean;
};

function getEventMeta(
    eventType: AlertEventType,
    isTestAlert: boolean = false
): {
    heading: string;
    previewText: string;
    summary: string;
    statusLabel: string | null;
    statusColor: string | null;
} {
    const meta = getBaseEventMeta(eventType);
    return isTestAlert ? { ...meta, heading: `[TEST] ${meta.heading}` } : meta;
}

function getBaseEventMeta(eventType: AlertEventType): {
    heading: string;
    previewText: string;
    summary: string;
    statusLabel: string | null;
    statusColor: string | null;
} {
    switch (eventType) {
        case "site_online":
            return {
                heading: "Site Back Online",
                previewText: "A site in your organization is back online.",
                summary:
                    "Good news – a site in your organization has come back online and is now reachable.",
                statusLabel: "Online",
                statusColor: "#16a34a"
            };
        case "site_offline":
            return {
                heading: "Site Offline",
                previewText: "A site in your organization has gone offline.",
                summary:
                    "A site in your organization has gone offline and is no longer reachable.",
                statusLabel: "Offline",
                statusColor: "#dc2626"
            };
        case "site_toggle":
            return {
                heading: "Site Status Changed",
                previewText: "A site in your organization has changed status.",
                summary: "A site in your organization has changed status.",
                statusLabel: null,
                statusColor: null
            };
        case "health_check_healthy":
            return {
                heading: "Health Check Recovered",
                previewText:
                    "A health check in your organization is now healthy.",
                summary:
                    "A health check in your organization has recovered and is now reporting a healthy status.",
                statusLabel: "Healthy",
                statusColor: "#16a34a"
            };
        case "health_check_unhealthy":
            return {
                heading: "Health Check Failing",
                previewText:
                    "A health check in your organization is not healthy.",
                summary:
                    "A health check in your organization is currently failing.",
                statusLabel: "Not Healthy",
                statusColor: "#dc2626"
            };
        case "health_check_toggle":
            return {
                heading: "Health Check Status Changed",
                previewText:
                    "A health check in your organization has changed status.",
                summary:
                    "A health check in your organization has changed status.",
                statusLabel: null,
                statusColor: null
            };
        case "resource_healthy":
            return {
                heading: "Resource Healthy",
                previewText: "A resource in your organization is now healthy.",
                summary:
                    "A resource in your organization has recovered and is now reporting a healthy status.",
                statusLabel: "Healthy",
                statusColor: "#16a34a"
            };
        case "resource_unhealthy":
            return {
                heading: "Resource Unhealthy",
                previewText: "A resource in your organization is not healthy.",
                summary:
                    "A resource in your organization is currently unhealthy.",
                statusLabel: "Unhealthy",
                statusColor: "#dc2626"
            };
        case "resource_degraded":
            return {
                heading: "Resource Degraded",
                previewText: "A resource in your organization is degraded.",
                summary:
                    "A resource in your organization is currently degraded.",
                statusLabel: "Degraded",
                statusColor: "#dc2626"
            };
        case "resource_toggle":
            return {
                heading: "Resource Status Changed",
                previewText:
                    "A resource in your organization has changed status.",
                summary: "A resource in your organization has changed status.",
                statusLabel: null,
                statusColor: null
            };
        default:
            return {
                heading: "Alert Notification",
                previewText:
                    "An alert event has occurred in your organization.",
                summary: "An alert event has occurred in your organization.",
                statusLabel: "Alert",
                statusColor: "#f59e0b"
            };
    }
}

function resolveToggleStatus(status: unknown): {
    label: string;
    color: string;
} {
    switch (String(status).toLowerCase()) {
        case "online":
            return { label: "Online", color: "#16a34a" };
        case "offline":
            return { label: "Offline", color: "#dc2626" };
        case "healthy":
            return { label: "Healthy", color: "#16a34a" };
        case "unhealthy":
            return { label: "Unhealthy", color: "#dc2626" };
        case "degraded":
            return { label: "Degraded", color: "#dc2626" };
        default:
            return { label: String(status ?? "Unknown"), color: "#f59e0b" };
    }
}

function formatDataItems(
    data: Record<string, unknown>
): { label: string; value: React.ReactNode }[] {
    return Object.entries(data)
        .filter(([key]) => key !== "orgId" && key !== "status")
        .map(([key, value]) => ({
            label: key
                .replace(/([A-Z])/g, " $1")
                .replace(/^./, (s) => s.toUpperCase())
                .trim(),
            value: String(value ?? "-")
        }));
}

export const AlertNotification = (props: AlertNotificationProps) => {
    const {
        eventType,
        orgId,
        data,
        dashboardLink,
        isTestAlert = false
    } = props;
    const meta = getEventMeta(eventType, isTestAlert);
    const dataItems = formatDataItems(data);

    const isToggle =
        eventType === "site_toggle" ||
        eventType === "health_check_toggle" ||
        eventType === "resource_toggle";

    const resolvedStatus = isToggle
        ? resolveToggleStatus(data.status)
        : meta.statusLabel != null
          ? { label: meta.statusLabel, color: meta.statusColor! }
          : null;

    const allItems: { label: string; value: React.ReactNode }[] = [
        { label: "Organization", value: orgId },
        ...(resolvedStatus != null
            ? [
                  {
                      label: "Status",
                      value: (
                          <span
                              style={{
                                  color: resolvedStatus.color,
                                  fontWeight: 600
                              }}
                          >
                              {resolvedStatus.label}
                          </span>
                      )
                  }
              ]
            : []),
        { label: "Time", value: new Date().toUTCString() },
        ...dataItems
    ];

    return (
        <Html>
            <Head />
            <Preview>{meta.previewText}</Preview>
            <Tailwind config={themeColors}>
                <Body className="font-sans bg-gray-50">
                    <EmailContainer>
                        <EmailLetterHead />

                        <EmailHeading>{meta.heading}</EmailHeading>

                        <EmailGreeting>Hi there,</EmailGreeting>

                        <EmailText>{meta.summary}</EmailText>

                        <EmailInfoSection
                            title="Event Details"
                            items={allItems}
                        />

                        <EmailText>
                            Open your dashboard to view more details and manage
                            your alert rules.
                        </EmailText>
                        {isTestAlert && (
                            <EmailText>
                                This is a test alert. No action is required,
                                and no real event has occurred.
                            </EmailText>
                        )}

                        <EmailSection>
                            <ButtonLink href={dashboardLink}>
                                Open Dashboard
                            </ButtonLink>
                        </EmailSection>

                        <EmailFooter>
                            <EmailSignature />
                        </EmailFooter>
                    </EmailContainer>
                </Body>
            </Tailwind>
        </Html>
    );
};

export default AlertNotification;
