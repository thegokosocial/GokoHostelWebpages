# Goko Hostel — premium site (Next.js)

Marketing site for Goko Hostel (Gokarna), rebuilt with the App Router, TypeScript, Tailwind CSS, and Framer Motion.

This repository **is** the Next.js app. The previous static Webflow-style export (HTML, `js/`, root `images/`) has been removed in favor of this project at the repo root.

## Setup

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Scripts

- `npm run dev` — development server
- `npm run build` — plain `next build` (what OpenNext calls internally; also fine as Cloudflare’s **Build command**)
- `npm run cf:build` — full **OpenNext** bundle (`.open-next/`) for Cloudflare
- `npm run start` — serve the last Next output locally (`next start`)
- `npm run lint` — ESLint (Next core web vitals)
- `npm run preview:cf` — build with [OpenNext Cloudflare](https://opennext.js.org/cloudflare) and preview in the Workers runtime locally ([`.dev.vars.example`](./.dev.vars.example) → `.dev.vars`)
- `npm run deploy:cf` — build and deploy to Cloudflare (requires `wrangler login`)

`wrangler.jsonc` defines a **custom build** (`npm run cf:build`), so `npx wrangler deploy` runs OpenNext even if the dashboard still uses the default **`npm run build`** (you’ll get two `next build` runs unless you clear the dashboard build step; see below).

## Deploy

Configure `src/lib/site.ts` `url` to your production domain before launch so metadata, canonical URLs, and `sitemap.xml` stay correct. Images use `next/image` with `unoptimized: true` in `next.config.ts`; you can enable Cloudflare Images later via OpenNext if you want optimization on Cloudflare.

### Cloudflare (recommended for gokohostel.com)

This repo is set up for **Cloudflare Workers** using **`@opennextjs/cloudflare`** (`wrangler.jsonc`, `open-next.config.ts`). That is the current supported way to run **Next.js** on Cloudflare (Workers Builds / Wrangler), which matches a custom domain like `gokohostel.com` cleanly.

**Option A — GitHub Actions (seamless on every push to `main`)**

1. In Cloudflare, create an API token with **Workers Scripts:Edit** (and account read as needed).
2. In the GitHub repo → **Settings → Secrets and variables → Actions**, add:
   - `CLOUDFLARE_API_TOKEN` — the token
   - `CLOUDFLARE_ACCOUNT_ID` — Cloudflare dashboard sidebar (Workers & Pages) **Account ID**
3. Push to `main`; [.github/workflows/deploy-cloudflare.yml](./.github/workflows/deploy-cloudflare.yml) runs `npm ci` then `wrangler deploy` (OpenNext runs via **`build.command`** in `wrangler.jsonc`).
4. In Cloudflare → your Worker **`goko-hostel-web`** → **Triggers → Custom Domains**, attach `www.gokohostel.com` / `gokohostel.com` (or only your canonical host and add a redirect rule for the other).

**Option B — Cloudflare dashboard only (Workers Builds)**

1. Workers & Pages → **Create** → connect this GitHub repo, production branch `main`, **root directory** empty.
2. **Install command (if the UI asks for it):** `npm ci`
3. **Build command:** You can keep the default **`npm run build`** — **`wrangler.jsonc`** tells Wrangler to run **`npm run cf:build`** during deploy, which fixes *“Could not find compiled Open Next config”*. To avoid building Next **twice** per deploy, clear the build command or set it to a no-op like `:` if Cloudflare allows it; otherwise leave it.
4. **Deploy command:** `npx wrangler deploy`
5. Attach the same custom domains on the Worker.

Use **either** GitHub Actions **or** Workers Builds for production deploys so you do not deploy twice per commit.

### Other hosts

For **Vercel**, **Netlify**, or a **Node** server, use **`npm run build`** / **`npm run start`**, or the platform’s Next.js preset (no `cf:build` or Wrangler).
