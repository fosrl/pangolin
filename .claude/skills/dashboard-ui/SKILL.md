---
name: dashboard-ui
description: Use whenever building or changing anything in the Next.js dashboard (`src/app`, `src/components`). That covers new pages, settings tabs, forms, modals/dialogs, banners, alerts, tables, toasts, or any user-facing text, and adding translation keys to messages/en-US.json.
---

Read `docs/ui-conventions.md` before writing UI code. The rules:

- **Translate every user-facing string** with `t("key")` (`useTranslations()` /
  `await getTranslations()`). No hard-coded English in JSX, toasts,
  placeholders, tab titles or user-facing validation messages.
- **Never write translations.** Add keys only to `messages/en-US.json`. Don't
  touch the other `messages/*.json` files. Reuse existing keys where they fit.
- **Modals are always `Credenza`** (`@app/components/Credenza`). Never use
  `Dialog`/`Sheet`/`Drawer`/`AlertDialog` directly. Use `ConfirmDeleteDialog` for
  deletes.
- **Info for the user goes in a `DismissableBanner`** (wrapped in a
  `src/components/<Feature>Banner.tsx`), not an `Alert`.
- **Prefer pages over modals** for objects with more than a few settings: list
  page + `create/page.tsx` + `[id]/layout.tsx` with `HorizontalTabs` and one
  route folder per tab. Model it on `src/app/[orgId]/settings/general/layout.tsx`
  and `src/app/[orgId]/settings/resources/public/[niceId]/layout.tsx`.
- Tab pages: `SettingsContainer` → one `SettingsSection` per concern, each
  with its own form (`id`) and footer Save button (`form="<id>"`). Model it on
  `src/app/[orgId]/settings/general/page.tsx`.
- Forms: react-hook-form + `zodResolver` + zod. Buttons use the `loading` prop
  and keep their text unchanged.
- Gate enterprise UI with `env.flags.disableEnterpriseFeatures`, and paid
  features with `usePaidStatus` + `tierMatrix` + `PaidFeaturesAlert`.
- New top-level pages need a sidebar entry in `src/app/navigation.tsx`.
