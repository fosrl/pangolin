export function replacePlaceholder(
    stringWithPlaceholder: string,
    data: Record<string, string>
) {
    let newString = stringWithPlaceholder;

    const keys = Object.keys(data);

    for (const key of keys) {
        newString = newString.replace(
            new RegExp(`{{${key}}}`, "gm"),
            data[key]
        );
    }

    return newString;
}
