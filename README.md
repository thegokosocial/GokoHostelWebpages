# Goko Hostel — premium site (Next.js)

Marketing site for Goko Hostel (Gokarna), rebuilt with the App Router, TypeScript, Tailwind CSS, and Framer Motion.

This repository **is** the Next.js app. The previous static Webflow-style export (HTML, `js/`, root `images/`) has been removed in favor of this project at the repo root.

## Setup

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## UI (shadcn + Base UI)

Interactive UI is built with the [shadcn](https://ui.shadcn.com/) **base-nova** stack (Base UI primitives + Tailwind + `class-variance-authority`). Source lives in `src/components/ui/`. Primary site actions use **`cta`**, **`ctaOutline`**, and **`ctaGhost`** on `Button` / `ButtonLink`. Add primitives anytime with `npx shadcn@latest add <name>` (see [`components.json`](./components.json)).

## Scripts

- `npm run dev` — development server
- `npm run build` — plain `next build` (what OpenNext calls internally; also fine as Cloudflare’s **Build command**)
- `npm run cf:build` — full **OpenNext** bundle (`.open-next/`) for Cloudflare
- `npm run start` — serve the last Next output locally (`next start`)
- `npm run lint` — ESLint (Next core web vitals)
- `npm run preview:cf` — build with [OpenNext Cloudflare](https://opennext.js.org/cloudflare) and preview in the Workers runtime locally ([`.dev.vars.example`](./.dev.vars.example) → `.dev.vars`)
- `npm run deploy:cf` — build and deploy to Cloudflare (requires `wrangler login`)

`wrangler.jsonc` **`build.command`** runs **only** when you use **Wrangler locally** or **GitHub Actions** `wrangler deploy`. **Cloudflare’s own Workers Builds CI ignores it**, so the dashboard **Build command** must be **`npm run cf:build`**.

## Deploy

Configure `src/lib/site.ts` `url` to your production domain before launch so metadata, canonical URLs, and `sitemap.xml` stay correct. Images use `next/image` with `unoptimized: true` in `next.config.ts`; you can enable Cloudflare Images later via OpenNext if you want optimization on Cloudflare.

### Cloudflare (recommended for gokohostel.com)

This repo is set up for **Cloudflare Workers** using **`@opennextjs/cloudflare`** (`wrangler.jsonc`, `open-next.config.ts`). That is the current supported way to run **Next.js** on Cloudflare (Workers Builds / Wrangler), which matches a custom domain like `gokohostel.com` cleanly.

**Option A — GitHub Actions (seamless on every push to `main`)**

1. In Cloudflare, create an API token with **Workers Scripts:Edit** (and account read as needed).
2. In the GitHub repo → **Settings → Secrets and variables → Actions**, add:
   - `CLOUDFLARE_API_TOKEN` — the token
   - `CLOUDFLARE_ACCOUNT_ID` — Cloudflare dashboard sidebar (Workers & Pages) **Account ID**
3. Push to `main`; [.github/workflows/deploy-cloudflare.yml](./.github/workflows/deploy-cloudflare.yml) runs `npm ci` then `wrangler deploy` (local Wrangler runs **`build.command`** in `wrangler.jsonc` before upload).
4. In Cloudflare → your Worker (**`name` in `wrangler.jsonc` must match**, e.g. **`goko-hostel-latest-webpage`**) → **Custom Domains**, attach `www.gokohostel.com` / `gokohostel.com` (or only your canonical host and add a redirect rule for the other).

**Option B — Cloudflare dashboard only (Workers Builds)**

1. Workers & Pages → **Create** → connect this GitHub repo, production branch `main`, **root directory** empty.
2. **Install command (if the UI asks for it):** `npm ci`
3. **Build command (required):** **`npm run cf:build`** (or `npx opennextjs-cloudflare build`).  
   **Do not** leave the default **`npm run build`** only. Cloudflare **Workers Builds does not run** the **`build.command`** block in `wrangler.jsonc`, so deploy never sees `.open-next/` and fails with *“Could not find compiled Open Next config”*.
4. **Deploy command:** `npx wrangler deploy`
5. Attach the same custom domains on the Worker.

Use **either** GitHub Actions **or** Workers Builds for production deploys so you do not deploy twice per commit.

### Other hosts

For **Vercel**, **Netlify**, or a **Node** server, use **`npm run build`** / **`npm run start`**, or the platform’s Next.js preset (no `cf:build` or Wrangler).
