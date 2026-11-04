# Dashboard UI conventions

The dashboard is Next.js App Router (`src/app`), with shadcn/Radix primitives in
`src/components/ui`, Tailwind, `next-intl` for i18n, and
`react-hook-form` + zod for forms.

## Translations (always)

- Every user-facing string goes through `t()`: labels, descriptions,
  placeholders, button text, toasts, tab titles, table headers, empty states,
  zod error messages shown to users, and `aria-label`s.
  - Client components: `const t = useTranslations();` from `next-intl`.
  - Server components / layouts: `const t = await getTranslations();` from
    `next-intl/server`.
  - Interpolation: `t("resourceSetting", { resourceName: resource.name })`, with
    `{resourceName}` in the message string.
- Add new keys **only** to `messages/en-US.json`. **Never** add or edit
  translations in the other `messages/*.json` files; Crowdin generates them.
- Before adding a key, search `messages/en-US.json` for an existing one
  (`general`, `name`, `saveSettings`, `learnMore`, `cancel`, `close`,
  `delete`...). Name new keys camelCase with a feature prefix (e.g.
  `orgGeneralSettingsDescription`, `domainsBannerTitle`).

## Modals: always Credenza

Use `Credenza` from `@app/components/Credenza` for every modal or dialog. It
renders a dialog on desktop and a bottom drawer on mobile. Don't import `Dialog`,
`Sheet`, `Drawer` or `AlertDialog` from `components/ui` directly.

```tsx
<Credenza open={open} onOpenChange={setOpen}>
    <CredenzaContent>
        <CredenzaHeader>
            <CredenzaTitle>{t("...")}</CredenzaTitle>
            <CredenzaDescription>{t("...")}</CredenzaDescription>
        </CredenzaHeader>
        <CredenzaBody>{/* form with id="my-form" */}</CredenzaBody>
        <CredenzaFooter>
            <CredenzaClose asChild>
                <Button variant="outline">{t("close")}</Button>
            </CredenzaClose>
            <Button type="submit" form="my-form" loading={loading} disabled={loading}>
                {t("save")}
            </Button>
        </CredenzaFooter>
    </CredenzaContent>
</Credenza>
```

Examples: `src/components/CreateSiteProvisioningKeyCredenza.tsx`,
`src/components/CustomDnsRecordCredenza.tsx`. For destructive confirmations, use
`ConfirmDeleteDialog` (a Credenza where the user types the name to confirm).

## Pages vs modals

- **Use pages** for anything that's an object with more than a few settings
  (resources, sites, clients, providers, policies, alert rules, ...):
  - list page: `src/app/[orgId]/settings/<things>/page.tsx` (table)
  - create page: `.../<things>/create/page.tsx`
  - detail page: `.../<things>/[id]/layout.tsx` + one folder per tab
- **Use a Credenza** only for small, quick forms (a couple of fields), pickers,
  and confirmations.

## Info for the user: DismissableBanner, not Alert

To explain a feature or give the user context on a page, use
`DismissableBanner` (`src/components/DismissableBanner.tsx`), not an `<Alert>`.
Wrap it in a small `<Feature>Banner.tsx` component:

```tsx
export const DomainsBanner = () => {
    const t = useTranslations();
    return (
        <DismissableBanner
            storageKey="domains-banner-dismissed"
            version={1}
            title={t("domainsBannerTitle")}
            titleIcon={<Globe className="w-5 h-5 text-primary" />}
            description={t("domainsBannerDescription")}
        />
    );
};
```

Render it under the `SettingsSectionTitle` of the page (see
`src/app/[orgId]/settings/domains/page.tsx`). Bump `version` to show it again
after changing the content. Existing banners (copy one): `src/components/*Banner.tsx`, e.g.
`DomainsBanner`, `SitesBanner`, `PublicResourcesBanner`,
`PrivateResourcesBanner`, `UsersBanner`, `ShareLinksBanner`.

Paywalled features use `<PaidFeaturesAlert tiers={tierMatrix.x} />`, which
handles its own visibility.

## Tabs: splitting an object's settings across pages

Detail and settings areas are split into **route-based tabs**. Each tab is its
own route segment with its own `page.tsx`, and a shared `layout.tsx` renders the
header and `HorizontalTabs`.

Example: org settings (`src/app/[orgId]/settings/general/`):

```
general/
  layout.tsx        server component: fetch org, build navItems, render tabs
  page.tsx          "General" tab (exact: true, because it is the index route)
  security/page.tsx "Security" tab
  logs/page.tsx     "Logs" tab
  auth-page/page.tsx "Auth Page" tab (hidden when enterprise features are disabled)
```

`layout.tsx` pattern:

```tsx
export default async function Layout({ children, params }) {
    const { orgId } = await params;
    const t = await getTranslations();
    // fetch the object server-side (internal + authCookieHeader, or getCachedOrg)
    // redirect(...) on failure

    const navItems: TabItem[] = [
        { title: t("general"), href: `/{orgId}/settings/general`, exact: true },
        { title: t("security"), href: `/{orgId}/settings/general/security` },
        ...(!env.flags.disableEnterpriseFeatures
            ? [{ title: t("authPage"), href: `/{orgId}/settings/general/auth-page` }]
            : [])
    ];

    return (
        <OrgProvider org={org}>
            <SettingsSectionTitle title={t("...")} description={t("...")} />
            <div className="space-y-4">
                <OrgInfoCard />                 {/* summary card for the object */}
                <HorizontalTabs items={navItems}>{children}</HorizontalTabs>
            </div>
        </OrgProvider>
    );
}
```

Notes:

- `href`s use placeholders (`{orgId}`, `{niceId}`, `{resourceId}`,
  `{clientId}`, `{userId}`, `{domainId}`, `{apiKeyId}`, `{providerId}`,
  `{remoteExitNodeId}`) that `HorizontalTabs` fills in from route params. If you
  add a new param name, add it to `hydrateHref` in
  `src/components/HorizontalTabs.tsx`.
- Use `exact: true` on a tab whose href is a prefix of the other tabs (the index
  tab).
- Build tabs conditionally from object state, like the resource layout shows
  mode-specific tabs:
  `src/app/[orgId]/settings/resources/public/[niceId]/layout.tsx`.
- When there's no index tab, `[id]/page.tsx` just `redirect`s to the first tab
  (`.../[niceId]/page.tsx` → `/general`).
- The layout puts the object into a Provider (`OrgProvider`,
  `ResourceProvider`, `SiteResourceProvider`, ...). Tab pages are client
  components that read it with the matching hook (`useOrgContext`,
  `useResourceContext`, `useSiteResourceContext`) and call `updateX(...)` on
  the context after saving so the header card stays current.
- `showProfessional` on a `TabItem` marks paid tabs.
- For tabs inside a single page or a Credenza (no routing), use
  `<HorizontalTabs clientSide items={...}>` with one child per tab.

### Inside a tab page

Each tab page is a `SettingsContainer` holding one or more `SettingsSection`s.
Each section is a separate concern with its own form and its own Save button in
the footer. See `src/app/[orgId]/settings/general/page.tsx`: a "General"
section form plus a separate danger-zone delete section.

```tsx
<SettingsContainer>
    <SettingsSection>
        <SettingsSectionHeader>
            <SettingsSectionTitle>{t("general")}</SettingsSectionTitle>
            <SettingsSectionDescription>{t("...")}</SettingsSectionDescription>
        </SettingsSectionHeader>
        <SettingsSectionBody>
            <SettingsSectionForm variant="half">
                <Form {...form}>
                    <form id="my-section-form" onSubmit={...}>
                        <SettingsFormGrid>
                            <SettingsFormCell span="half">{/* FormField */}</SettingsFormCell>
                            <SettingsFormCell span="full">{/* SwitchInput */}</SettingsFormCell>
                        </SettingsFormGrid>
                    </form>
                </Form>
            </SettingsSectionForm>
        </SettingsSectionBody>
        <SettingsSectionFooter>
            <Button type="submit" form="my-section-form" loading={saving} disabled={saving}>
                {t("saveSettings")}
            </Button>
        </SettingsSectionFooter>
    </SettingsSection>
</SettingsContainer>
```

- `SettingsFormGrid` is a 4-column grid. `SettingsFormCell span` is
  `"quarter" | "half" | "full"`.
- Switches use `SwitchInput` (`@app/components/SwitchInput`).
- The submit button sits in the footer, outside the `<form>`, and links to it
  with `form="<id>"`.

## Forms

- `useForm({ resolver: zodResolver(schema), defaultValues })` with shadcn
  `Form`/`FormField`/`FormItem`/`FormLabel`/`FormControl`/`FormDescription`/`FormMessage`.
- If the schema has user-facing error messages, build it inside the component
  with `t` (e.g. `createGeneralFormSchema(t)` in `src/lib/privateResourceForm.ts`).
- Saving: `useActionState(performSave, null)` + `startTransition(() => formAction())`
  (see general/page.tsx), or a `useTransition`. Give the button `loading` and
  keep its text the same while loading.
- Results: `toast({ title: t("..."), description: t("...") })`. On error:
  `toast({ variant: "destructive", title: t("..."), description: formatAxiosError(e, t("...")) })`.
  Call `router.refresh()` after saving when server components show the value.

## Paywalls and build gating in the UI

- `useEnvContext().env.flags.disableEnterpriseFeatures`: hide enterprise UI.
- `usePaidStatus().isPaidUser(tierMatrix[TierFeature.X])`: disable controls
  for unpaid orgs, and pair it with `<PaidFeaturesAlert tiers={tierMatrix.x} />`.
- `build` from `@server/build` for oss/enterprise/saas differences.

## Navigation

Sidebar entries live in `src/app/navigation.tsx` (`orgNavSections`,
`adminNavSections`, `commandBarNavSections`). Add a new top-level settings page
there, with a translated title.
