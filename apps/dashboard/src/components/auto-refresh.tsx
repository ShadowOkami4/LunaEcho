"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/** Reloads the page's server data every few seconds while something is still changing. */
export function AutoRefresh({ seconds = 5 }: Readonly<{ seconds?: number }>) {
  const router = useRouter();

  useEffect(() => {
    const timer = setInterval(() => {
      router.refresh();
    }, seconds * 1000);
    return () => {
      clearInterval(timer);
    };
  }, [router, seconds]);

  return null;
}
