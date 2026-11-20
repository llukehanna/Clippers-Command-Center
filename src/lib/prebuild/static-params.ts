// Which dynamic-route params to prerender. Dependency-free (env reads only) so
// it is safe to call from any page's generateStaticParams.
//
// Normal builds (CI on every push) render a small sample (first 3 + last 3) to
// keep builds fast and cheap; PREBUILD_FULL=1 renders everything, and `next dev`
// always gets everything.

export function staticParams<T>(all: T[]): T[] {
  if (process.env.NODE_ENV === 'development') return all
  if (process.env.PREBUILD_FULL === '1') return all
  if (all.length <= 6) return all
  return [...all.slice(0, 3), ...all.slice(-3)]
}
