import React from "react";
import { Body, Head, Html, Preview, Tailwind } from "@react-email/components";
import { themeColors } from "./lib/theme";
import {
    EmailContainer,
    EmailFooter,
    EmailGreeting,
    EmailHeading,
    EmailLetterHead,
    EmailSection,
    EmailSignature,
    EmailText,
    EmailInfoSection
} from "./components/Email";
import ButtonLink from "./components/ButtonLink";
import CopyCodeBox from "./components/CopyCodeBox";

interface WelcomeQuickStartProps {
    username?: string;
    link: string;
    fallbackLink: string;
    resourceMethod: string;
    resourceHostname: string;
    resourcePort: string | number;
    resourceUrl: string;
    cliCommand: string;
}

export const WelcomeQuickStart = ({
    username,
    link,
    fallbackLink,
    resourceMethod,
    resourceHostname,
    resourcePort,
    resourceUrl,
    cliCommand
}: WelcomeQuickStartProps) => {
    const previewText = "Welcome! Here's what to do next";

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
                            Thank you for trying out Pangolin! We're excited to
                            have you on board.
                        </EmailText>

                        <EmailText>
                            To continue to configure your site, resources, and
                            other features, complete your account setup to
                            access the full dashboard.
                        </EmailText>

                        <EmailSection>
                            <ButtonLink href={link}>
                                View Your Dashboard
                            </ButtonLink>
                            {/* <p className="text-sm text-gray-300 mt-2"> */}
                            {/*     If the button above doesn't work, you can also */}
                            {/*     use this{" "} */}
                            {/*     <a href={fallbackLink} className="underline"> */}
                            {/*         link */}
                            {/*     </a> */}
                            {/*     . */}
                            {/* </p> */}
                        </EmailSection>

                        <EmailSection>
                            <div className="mb-2 font-semibold text-gray-900 text-base text-left">
                                Connect your site using Newt
                            </div>
                            <div className="inline-block w-full">
                                <div className="bg-gray-50 border border-gray-200 rounded-lg px-6 py-4 mx-auto text-left">
                                    <span className="text-sm font-mono text-gray-900 tracking-wider">
                                        {cliCommand}
                                    </span>
                                </div>
                                <p className="text-xs text-gray-500 mt-2">
                                    To learn how to use Newt, including more
                                    installation methods, visit the{" "}
                                    <a
                                        href="https://docs.pangolin.net/manage/sites/install-site"
                                        className="underline"
                                    >
                                        docs
                                    </a>
                                    .
                                </p>
                            </div>
                        </EmailSection>

                        <EmailInfoSection
                            title="Your Demo Resource"
                            items={[
                                { label: "Method", value: resourceMethod },
                                { label: "Hostname", value: resourceHostname },
                                { label: "Port", value: resourcePort },
                                {
                                    label: "Resource URL",
                                    value: (
                                        <a
                                            href={resourceUrl}
                                            className="underline text-blue-600"
                                        >
                                            {resourceUrl}
                                        </a>
                                    )
                                }
                            ]}
                        />

                        <EmailFooter>
                            <EmailSignature />
                        </EmailFooter>
                    </EmailContainer>
                </Body>
            </Tailwind>
        </Html>
    );
};

export default WelcomeQuickStart;
