export function Logo({ size = "md", light = false }: { size?: "sm" | "md" | "lg"; light?: boolean }) {
  const dims = size === "lg" ? "h-11 w-11" : size === "sm" ? "h-7 w-7" : "h-9 w-9";
  const text = size === "lg" ? "text-2xl" : size === "sm" ? "text-base" : "text-lg";
  return (
    <span className="inline-flex items-center gap-2">
      <span className={`${dims} relative shrink-0 overflow-hidden rounded-xl bg-white`}>
        <img
          src="/mireli-logo.jpeg"
          alt=""
          aria-hidden="true"
          className="absolute left-1/2 top-0 h-[150%] max-w-none -translate-x-1/2"
        />
      </span>
      <span className={`${text} font-bold tracking-tight ${light ? "text-primary-foreground" : "text-primary"}`}>
        Mi<span className="text-accent-foreground">-</span>Reli
      </span>
    </span>
  );
}
