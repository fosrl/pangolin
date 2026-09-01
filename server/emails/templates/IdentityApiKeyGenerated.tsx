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

type IdentityApiKeyGeneratedProps = {
    orgName: string;
    accountLabel?: string | null;
    credential: string;
    resourceUrls: string[];
    hasMoreResources: boolean;
};

export const IdentityApiKeyGenerated = ({
    orgName,
    accountLabel,
    credential,
    resourceUrls,
    hasMoreResources
}: IdentityApiKeyGeneratedProps) => {
    const previewText = `Your personal identity key for ${orgName}`;

    return (
        <Html>
            <Head />
            <Preview>{previewText}</Preview>
            <Tailwind config={themeColors}>
                <Body className="font-sans bg-gray-50">
                    <EmailContainer>
                        <EmailLetterHead />

                        <EmailGreeting>Hi there,</EmailGreeting>

                        <EmailText>
                            This is your personal identity key for{" "}
                            <strong>{orgName}</strong>. It belongs to your
                            account and identifies you when you use public AI
                            gateways.
                        </EmailText>

                        <EmailText>
                            Use it with resources your administrator has granted
                            you, or that your role has access to. Treat this key
                            like a password and do not share it.
                        </EmailText>

                        <EmailSection>
                            <EmailText>Your identity key:</EmailText>
                            <div className="inline-block max-w-full">
                                <div className="bg-gray-50 border border-gray-200 rounded-lg px-4 py-3 mx-auto text-left">
                                    <span className="text-sm font-mono text-gray-900 break-all">
                                        {credential}
                                    </span>
                                </div>
                            </div>
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

export default IdentityApiKeyGenerated;
