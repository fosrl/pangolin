import { useLocale } from "next-intl";
import LocaleSwitcherSelect from "./LocaleSwitcherSelect";

export default function LocaleSwitcher() {
    const locale = useLocale();

    return (
        <LocaleSwitcherSelect
            label="Select language"
            defaultValue={locale}
            items={[
                {
                    value: "en-US",
                    label: "English"
                },
                {
                    value: "fr-FR",
                    label: "Français"
                },
                {
                    value: "de-DE",
                    label: "Deutsch"
                },
                {
                    value: "it-IT",
                    label: "Italiano"
                },
                {
                    value: "nl-NL",
                    label: "Nederlands"
                },
                {
                    value: "pl-PL",
                    label: "Polski"
                },
                {
                    value: "pt-PT",
                    label: "Português"
                },
                {
                    value: "es-ES",
                    label: "Español"
                },
                {
                    value: "tr-TR",
                    label: "Türkçe"
                },
                {
                    value: "zh-CN",
                    label: "简体中文"
                },
                {
                    value: "ko-KR",
                    label: "한국어"
                },
                {
                    value: "nb-NO",
                    label: "Norsk (Bokmål)"
                },
                {
                    value: "zh-TW",
                    label: "繁體中文"
                }
            ]}
        />
    );
}