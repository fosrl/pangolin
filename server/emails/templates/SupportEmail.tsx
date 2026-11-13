import React from "react";
import { Body, Head, Html, Preview, Tailwind } from "@react-email/components";
import { themeColors } from "./lib/theme";
import {
    EmailContainer,
    EmailGreeting,
    EmailInfoSection,
    EmailLetterHead,
    EmailText
} from "./components/Email";

// Details of the license a support request is about. Only set for requests
// sent from the license page, so support does not have to ask for them.
type SupportEmailLicense = {
    orgId: string;
    licenseKey: string;
    instanceName: string | null;
    tier: string;
    type: string;
    isValid: boolean;
    expiresAt: string;
    users: number;
    sites: number;
    machines: number;
    support: string;
    highAvailability: boolean;
    stripeSubscriptionId: string | null;
};

interface SupportEmailProps {
    email: string;
    username: string;
    subject: string;
    body: string;
    license?: SupportEmailLicense;
}

export const SupportEmail = ({
    username,
    email,
    body,
    subject,
    license
}: SupportEmailProps) => {
    const previewText = subject;

    return (
        <Html>
            <Head />
            <Preview>{previewText}</Preview>
            <Tailwind config={themeColors}>
                <Body className="font-sans bg-gray-50">
                    <EmailContainer>
                        <EmailLetterHead />

                        <EmailGreeting>Hi support,</EmailGreeting>

                        <EmailText>
                            You have received a new support request from{" "}
                            <strong>{username}</strong> ({email}).
                        </EmailText>

                        {license && (
                            <>
                                <EmailText>
                                    This is a{" "}
                                    <strong>software support request</strong>{" "}
                                    for a self-hosted instance, not a license or
                                    billing question. It was sent from the
                                    Licenses page in Pangolin Cloud, and the
                                    user was told we have the license details
                                    below.
                                </EmailText>
                                <EmailInfoSection
                                    title="License details"
                                    items={[
                                        {
                                            label: "License key",
                                            value: license.licenseKey
                                        },
                                        {
                                            label: "Organization",
                                            value: license.orgId
                                        },
                                        {
                                            label: "Server ID",
                                            value: license.instanceName || "-"
                                        },
                                        { label: "Tier", value: license.tier },
                                        { label: "Type", value: license.type },
                                        {
                                            label: "Valid",
                                            value: license.isValid
                                                ? "Yes"
                                                : "No"
                                        },
                                        {
                                            label: "Expires",
                                            value: license.expiresAt
                                        },
                                        {
                                            label: "Users",
                                            value: license.users
                                        },
                                        {
                                            label: "Sites",
                                            value: license.sites
                                        },
                                        {
                                            label: "Machine clients",
                                            value: license.machines
                                        },
                                        {
                                            label: "Support",
                                            value: license.support
                                        },
                                        {
                                            label: "High availability",
                                            value: license.highAvailability
                                                ? "Yes"
                                                : "No"
                                        },
                                        {
                                            label: "Stripe subscription",
                                            value:
                                                license.stripeSubscriptionId ||
                                                "-"
                                        }
                                    ]}
                                />
                            </>
                        )}

                        <EmailText>
                            <strong>Subject:</strong> {subject}
                        </EmailText>

                        <EmailText>
                            <strong>Message:</strong> {body}
                        </EmailText>
                    </EmailContainer>
                </Body>
            </Tailwind>
        </Html>
    );
};

export default SupportEmail;
