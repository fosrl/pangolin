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
    modifySubscriptionLink?: string;
};

export const EnterpriseEditionKeyGenerated = ({
    keyValue,
    personalUseOnly,
    users,
    sites,
    modifySubscriptionLink
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
                                        }
                                    ]}
                                />
                                {modifySubscriptionLink && (
                                    <EmailSection>
                                        <ButtonLink
                                            href={modifySubscriptionLink}
                                        >
                                            Modify subscription
                                        </ButtonLink>
                                    </EmailSection>
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

                        <EmailText>
                            For any questions or concerns regarding your license
                            or billing, please reach out to support at{" "}
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
