import { isTauri } from "@tauri-apps/api/core";
import { mockPlatform } from "./mock";
import { nativePlatform } from "./native";
import type { Platform } from "./types";

export * from "./defaults";
export * from "./types";

/** The UI imports only this. Browser (`pnpm dev:web`) gets the mock, the Tauri app gets the real thing. */
export const platform: Platform = isTauri() ? nativePlatform : mockPlatform;
