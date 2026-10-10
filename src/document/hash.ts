/** Lowercase hex SHA-256 of some bytes (WebCrypto: the same in the WebView, the browser and Node). */
export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const copy = new Uint8Array(bytes); // a plain ArrayBuffer, whatever the input was backed by
  const digest = await crypto.subtle.digest("SHA-256", copy);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}
