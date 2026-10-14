/** Code and tests packed into a URL fragment, so a link can carry them. Nothing leaves the browser. */

export interface Shared {
  code: string
  tests: string
}

export const SHARE_PREFIX = "#code="

export function encodeShare({ code, tests }: Shared): string {
  let binary = ""
  for (const byte of new TextEncoder().encode(JSON.stringify({ code, tests }))) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
}

/** The shared code, or null when the fragment is not one of ours or is damaged. */
export function decodeShare(fragment: string): Shared | null {
  const b64 = fragment.replace(/-/g, "+").replace(/_/g, "/")
  try {
    const binary = atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4))
    const data: unknown = JSON.parse(new TextDecoder().decode(Uint8Array.from(binary, (c) => c.charCodeAt(0))))
    if (typeof data === "object" && data !== null && "code" in data && "tests" in data) {
      const { code, tests } = data
      if (typeof code === "string" && typeof tests === "string") return { code, tests }
    }
  } catch {
    // Fall through: the caller tells the visitor the link is broken.
  }
  return null
}
