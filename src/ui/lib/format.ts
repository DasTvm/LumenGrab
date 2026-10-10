/** "1.2 MB", the way Finder and Explorer show file sizes (decimal units). */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "";
  if (bytes < 1000) return `${String(Math.round(bytes))} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1000;
  let unit = 0;
  while (value >= 999.95 && unit < units.length - 1) {
    value /= 1000;
    unit += 1;
  }
  const text = value >= 100 || (unit === 0 && value >= 10) ? value.toFixed(0) : value.toFixed(1);
  return `${text.replace(/\.0$/, "")} ${units[unit] ?? "GB"}`;
}
