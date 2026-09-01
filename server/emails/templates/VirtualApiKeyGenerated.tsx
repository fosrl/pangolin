import React from "react";
import { Body, Head, Html, Preview, Tailwind } from "@react-email/components";
import { themeColors } from "./lib/theme";
import {
    EmailContainer,
    EmailFooter,
    EmailGreeting,
    EmailInfoSection,
    EmailLetterHead,
    EmailSection,
    EmailSignature,
    EmailText
} from "./components/Email";

type VirtualApiKeyGeneratedProps = {
    orgName: string;
    keyName: string | null;
    credential: string;
    resourceUrls: string[];
    hasMoreResources: boolean;
};

export const VirtualApiKeyGenerated = ({
    orgName,
    keyName,
    credential,
    resourceUrls,
    hasMoreResources
}: VirtualApiKeyGeneratedProps) => {
    const previewText = `A virtual API key for ${orgName} has been shared with you`;

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
                            A virtual API key for <strong>{orgName}</strong> has
                            been shared with you. This key grants access to the
                            public AI gateways it was created for. Treat this
                            key like a password and do not share it.
                        </EmailText>

                        <EmailSection>
                            <EmailText>Your virtual API key:</EmailText>
                            <div className="inline-block max-w-full">
                                <div className="bg-gray-50 border border-gray-200 rounded-lg px-4 py-3 mx-auto text-left">
                                    <span className="text-sm font-mono text-gray-900 break-all">
                                        {credential}
                                    </span>
                                </div>
                            </div>
                        </EmailSection>

                        <EmailInfoSection
                            title="Key details"
                            items={[
                                {
                                    label: "Organization",
                                    value: orgName
                                },
                                ...(keyName
                                    ? [
                                          {
                                              label: "Name",
                                              value: keyName
                                          }
                                      ]
                                    : [])
                            ]}
                        />

                        {resourceUrls.length > 0 && (
                            <>
                                <EmailText>
                                    This key can be used to authenticate to the
                                    following AI gateway resources:
                                </EmailText>
                                <div className="px-6 pb-2">
                                    {resourceUrls.map((url) => (
                                        <p
                                            key={url}
                                            className="text-base text-gray-700 leading-relaxed"
                                        >
                                            <a
                                                href={url}
                                                className="text-primary font-medium break-all"
                                            >
                                                {url}
                                            </a>
                                        </p>
                                    ))}
                                </div>
                                {hasMoreResources && (
                                    <EmailText>
                                        Contact your administrator to get the
                                        full list.
                                    </EmailText>
                                )}
                            </>
                        )}

                        <EmailFooter>
                            <EmailSignature />
                        </EmailFooter>
                    </EmailContainer>
                </Body>
            </Tailwind>
        </Html>
    );
};

export default VirtualApiKeyGenerated;
