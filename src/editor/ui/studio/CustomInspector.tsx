import type { ShaderLayer } from "@/shader/types";

/** The settings of a layer with your own code (the Settings and Code tabs). */
export function CustomInspector({ layer }: { layer: ShaderLayer }) {
  return <p className="text-[13px] text-muted-foreground">{layer.name ?? "Shader"}</p>;
}
