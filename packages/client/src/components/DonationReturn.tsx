"use client";

import { useEffect } from "react";

import { recordDonationReturn } from "@/lib/donation";

/**
 * Handles `?supported=1` on whichever page the donate page links back to.
 * Mounted in the root layout because that page could be `/` or `/editor`.
 * Renders nothing. See `@/lib/donation`.
 */
export function DonationReturn(): null {
  useEffect(() => {
    recordDonationReturn();
  }, []);
  return null;
}
