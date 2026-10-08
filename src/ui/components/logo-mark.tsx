import type { ComponentProps } from "react";

/**
 * The LumenGrab mark: four corner blades around a light dot. Geometry from the brand file
 * (viewBox 240). Blades use `currentColor`; the dot is the brand lime unless overridden.
 * The name and the logo are not licensed for reuse (README).
 */
export function LogoMark({
  dot = "var(--lg-brand)",
  ...props
}: { dot?: string } & ComponentProps<"svg">) {
  return (
    <svg viewBox="0 0 240 240" fill="none" aria-hidden {...props}>
      <path
        fill="currentColor"
        d="M52 12H108A20 20 0 0 1 108 52H64A12 12 0 0 0 52 64A20 20 0 0 1 12 64V52A40 40 0 0 1 52 12Z"
      />
      <path
        fill="currentColor"
        d="M228 52V108A20 20 0 0 1 188 108V64A12 12 0 0 0 176 52A20 20 0 0 1 176 12H188A40 40 0 0 1 228 52Z"
      />
      <path
        fill="currentColor"
        d="M188 228H132A20 20 0 0 1 132 188H176A12 12 0 0 0 188 176A20 20 0 0 1 228 176V188A40 40 0 0 1 188 228Z"
      />
      <path
        fill="currentColor"
        d="M12 188V132A20 20 0 0 1 52 132V176A12 12 0 0 0 64 188A20 20 0 0 1 64 228H52A40 40 0 0 1 12 188Z"
      />
      <circle cx="120" cy="120" r="38" fill={dot} />
    </svg>
  );
}
