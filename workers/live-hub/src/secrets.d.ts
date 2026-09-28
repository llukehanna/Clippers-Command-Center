// Secrets aren't in wrangler.jsonc, so `wrangler types` doesn't emit them.
// worker-configuration.d.ts declares the global `Env` and `Cloudflare.Env`
// (what `cloudflare:workers` exports as `env`) separately, so augment both.
declare namespace Cloudflare {
  interface Env {
    LIVE_HUB_SECRET: string;
  }
}

interface Env {
  LIVE_HUB_SECRET: string;
}
