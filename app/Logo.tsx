import { LOGOS } from "@/lib/logos";

/**
 * A brand mark, inlined so it inherits currentColor and follows the theme.
 * `lockup` adds the wordmark, which is what a logo wall wants.
 */
export function Logo({
  maker,
  variant = "mark",
  className = "h-5",
}: {
  maker: string;
  variant?: "mark" | "lockup";
  className?: string;
}) {
  const entry = LOGOS[maker];
  if (!entry) return null;
  return (
    <span
      role="img"
      aria-label={entry.name}
      className={`inline-flex shrink-0 items-center [&>svg]:h-full [&>svg]:w-auto ${className}`}
      dangerouslySetInnerHTML={{ __html: variant === "lockup" ? entry.lockup : entry.mono }}
    />
  );
}
