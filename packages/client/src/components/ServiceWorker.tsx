"use client";

import { useEffect } from "react";

import { setUpServiceWorker } from "@/lib/service-worker";

/** Registers the offline worker once per page load; renders nothing. */
export function ServiceWorker(): null {
  useEffect(() => {
    void setUpServiceWorker();
  }, []);
  return null;
}
