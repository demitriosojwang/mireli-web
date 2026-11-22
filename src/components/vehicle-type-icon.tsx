import type { VehicleCategory } from "@/lib/vehicle-types";
import { cn } from "@/lib/utils";

export function VehicleTypeIcon({ category, className }: { category: VehicleCategory; className?: string }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 32 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={cn("shrink-0", className)}
    >
      {category === "motorbike" ? (
        <>
          <circle cx="7" cy="18" r="4" /><circle cx="25" cy="18" r="4" />
          <path d="M7 18h6l4-7h4l4 7M12 11h5l3 3M20 11l2-4h3M15 8h4" />
        </>
      ) : category === "tuk-tuk" ? (
        <>
          <circle cx="7" cy="18" r="3.5" /><circle cx="25" cy="18" r="3.5" />
          <path d="M7 18h17M9 14V8h13l3 6M11 8l2-4h8l1 4M13 11h6M22 14h3" />
        </>
      ) : category === "car" ? (
        <>
          <circle cx="8" cy="18" r="3.5" /><circle cx="24" cy="18" r="3.5" />
          <path d="M4.5 18H3v-5l3-1 3-6h12l4 6 3 1v5h-3M11 6l-2 6h12l-3-6M5 13h22" />
        </>
      ) : category === "van" ? (
        <>
          <circle cx="8" cy="18" r="3.5" /><circle cx="24" cy="18" r="3.5" />
          <path d="M4.5 18H3V6h19v6h4l3 4v2h-4M8 6v7h14M25 12v5M6 9h9" />
        </>
      ) : (
        <>
          <circle cx="8" cy="18" r="3.5" /><circle cx="24" cy="18" r="3.5" />
          <path d="M4.5 18H3v-7h23l3 4v3h-5M8 11V6h12v5" />
        </>
      )}
    </svg>
  );
}
