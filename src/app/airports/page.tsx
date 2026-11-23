"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * The old Airports page now redirects into the unified Book flow with the
 * Airport destination type pre-selected, so old links and bookmarks keep
 * working without maintaining a second booking surface.
 */
export default function AirportsRedirect() {
  const router = useRouter();

  useEffect(() => {
    router.replace("/?type=airport");
  }, [router]);

  return (
    <div className="flex min-h-dvh items-center justify-center bg-background">
      <p className="text-sm text-muted-foreground">Opening airport shuttles…</p>
    </div>
  );
}
