// scripts/cloudflare/strip-env.mjs
// Run between `opennextjs-cloudflare build` and `deploy` (see package.json).
//
// OpenNext copies the values of every .env file it finds — .env.local
// included — into .open-next/cloudflare/next-env.mjs, which is bundled into
// the deployed Worker and populates process.env at runtime. A build from a
// checkout with a real .env.local would therefore ship DATABASE_URL and API
// keys inside the Worker script. This rewrites the file to keep only
// NEXT_PUBLIC_* values (public by definition, and already inlined into the
// client bundle). Runtime secrets belong in `wrangler secret put`.
//
// Prints dropped key names only, never values.

import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const file = path.resolve('.open-next/cloudflare/next-env.mjs')
if (!fs.existsSync(file)) {
  console.error(`strip-env: ${file} not found; run opennextjs-cloudflare build first`)
  process.exit(1)
}

const modes = await import(`${pathToFileURL(file).href}?t=${Date.now()}`)
const dropped = new Set()
let out = ''
for (const [mode, vars] of Object.entries(modes)) {
  const kept = {}
  for (const [key, value] of Object.entries(vars ?? {})) {
    if (key.startsWith('NEXT_PUBLIC_')) kept[key] = value
    else dropped.add(key)
  }
  out += `export const ${mode} = ${JSON.stringify(kept)};\n`
}
fs.writeFileSync(file, out)
console.log(
  dropped.size
    ? `strip-env: removed from the Worker bundle: ${[...dropped].sort().join(', ')}`
    : 'strip-env: no non-public .env values in the Worker bundle'
)
