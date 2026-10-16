import { useEffect, useState } from "react";

const QUERY = "(prefers-reduced-motion: reduce)";

/** Whether the system asks for less motion ("Reduce Motion" on macOS, "Show animations" off on Windows). Animated backgrounds then start paused. */
export function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia(QUERY).matches;
}

export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(prefersReducedMotion);
  useEffect(() => {
    const media = window.matchMedia(QUERY);
    const update = () => {
      setReduced(media.matches);
    };
    media.addEventListener("change", update);
    return () => {
      media.removeEventListener("change", update);
    };
  }, []);
  return reduced;
}
