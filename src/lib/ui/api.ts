// Server-side JSON fetch for pages. Same base-URL convention the pages have
// always used; returns null instead of throwing so pages can render a
// designed error state.

const BASE = process.env.NEXT_PUBLIC_BASE_URL ?? 'http://localhost:3000'

export async function getJson<T>(path: string): Promise<T | null> {
  try {
    const res = await fetch(`${BASE}${path}`, { cache: 'no-store' })
    if (!res.ok) return null
    return (await res.json()) as T
  } catch {
    return null
  }
}
