"use client";

import NextTopLoader from "nextjs-toploader";

export function TopLoader() {
  return (
    <NextTopLoader
      color="var(--color-primary)"
      showSpinner={false}
      height={2}
    />
  );
}
