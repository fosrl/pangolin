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
import CopyCodeBox from "./components/CopyCodeBox";
import ButtonLink from "./components/ButtonLink";

type EnterpriseEditionKeyGeneratedProps = {
    keyValue: string;
    personalUseOnly: boolean;
    users: number;
    sites: number;
    machines: number;
    // Support level and add-ons on the license
    support?: "community" | "email" | "priority";
    highAvailability?: boolean;
    // Set when the license is linked to an org in Pangolin Cloud
    modifySubscriptionLink?: string;
    // Set when it isn't linked yet: sign up with the buyer's email to manage it
    signUpLink?: string;
};

const SUPPORT_LABELS = {
    community: "Community",
    email: "Email support",
    priority: "Priority support"
} as const;

export const EnterpriseEditionKeyGenerated = ({
    keyValue,
    personalUseOnly,
    users,
    sites,
    machines,
    support = "community",
    highAvailability = false,
    modifySubscriptionLink,
    signUpLink
}: EnterpriseEditionKeyGeneratedProps) => {
    const previewText = personalUseOnly
        ? "Your Enterprise Edition key for personal use is ready"
        : "Thank you for your purchase - your Enterprise Edition key is ready";

    return (
        <Html>
            <Head />
            <Preview>{previewText}</Preview>
            <Tailwind config={themeColors}>
                <Body className="font-sans bg-gray-50">
                    <EmailContainer>
                        <EmailLetterHead />

                        <EmailGreeting>Hi there,</EmailGreeting>

                        {personalUseOnly ? (
                            <EmailText>
                                Your Enterprise Edition license key has been
                                generated. Qualifying users can use the
                                Enterprise Edition for free for{" "}
                                <strong>personal use only</strong>.
                            </EmailText>
                        ) : (
                            <>
                                <EmailText>
                                    Thank you for your purchase. Your Enterprise
                                    Edition license key is ready. Below are the
                                    terms of your license.
                                </EmailText>
                                <EmailInfoSection
                                    title="License details"
                                    items={[
                                        {
                                            label: "Licensed users",
                                            value: users
                                        },
                                        {
                                            label: "Licensed sites",
                                            value: sites
                                        },
                                        {
                                            label: "Licensed machine clients",
                                            value: machines
                                        },
                                        {
                                            label: "Support",
                                            value: SUPPORT_LABELS[support]
                                        },
                                        {
                                            label: "Add-ons",
                                            value: highAvailability
                                                ? "High availability"
                                                : "None"
                                        }
                                    ]}
                                />
                                {modifySubscriptionLink ? (
                                    <EmailSection>
                                        <EmailText>
                                            Manage billing or change the number
                                            of users, sites and machine clients,
                                            or the support level and add-ons, on
                                            this license from your Pangolin
                                            Cloud account.
                                        </EmailText>
                                        <ButtonLink
                                            href={modifySubscriptionLink}
                                        >
                                            Manage license
                                        </ButtonLink>
                                    </EmailSection>
                                ) : (
                                    signUpLink && (
                                        <EmailSection>
                                            <EmailText>
                                                To manage billing or change the
                                                number of users, sites and
                                                machine clients on this license,
                                                sign up for a free Pangolin
                                                Cloud account with this email
                                                address. The license is linked
                                                to your account when you create
                                                your organization.
                                            </EmailText>
                                            <ButtonLink href={signUpLink}>
                                                Sign up for Pangolin Cloud
                                            </ButtonLink>
                                        </EmailSection>
                                    )
                                )}
                            </>
                        )}

                        <EmailSection>
                            <EmailText>Your license key:</EmailText>
                            <CopyCodeBox
                                text={keyValue}
                                hint="Copy this key and use it when activating Enterprise Edition on your Pangolin host."
                            />
                        </EmailSection>

                        {!personalUseOnly && support !== "community" && (
                            <div className="mx-6 my-4 rounded-md border border-gray-200 bg-gray-50 px-4 py-3">
                                <div className="mb-1 font-semibold text-gray-900 text-base">
                                    Need help with Pangolin?
                                </div>
                                <p className="mt-0 mb-2 text-base text-gray-700 leading-relaxed">
                                    Your license includes{" "}
                                    {SUPPORT_LABELS[support].toLowerCase()}. To
                                    make a software support request for your
                                    self-hosted instance, submit it from the{" "}
                                    <strong>Licenses</strong> page on Pangolin
                                    Cloud. We will already have your license
                                    details, so you don&apos;t need to include
                                    them in your request.
                                </p>
                                {(modifySubscriptionLink || signUpLink) && (
                                    <a
                                        href={
                                            modifySubscriptionLink ?? signUpLink
                                        }
                                        className="text-primary font-medium"
                                    >
                                        {modifySubscriptionLink
                                            ? "Open the Licenses page"
                                            : "Sign up for Pangolin Cloud"}
                                    </a>
                                )}
                            </div>
                        )}

                        <EmailText>
                            For license or billing questions, please reach out
                            to support at{" "}
                            <a
                                href="mailto:support@pangolin.net"
                                className="text-primary font-medium"
                            >
                                support@pangolin.net
                            </a>
                            .
                        </EmailText>

                        <EmailFooter>
                            <EmailSignature />
                        </EmailFooter>
                    </EmailContainer>
                </Body>
            </Tailwind>
        </Html>
    );
};

export default EnterpriseEditionKeyGenerated;
