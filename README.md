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
- `npm run build` — production build
- `npm run start` — serve production build
- `npm run lint` — ESLint (Next core web vitals)

## Deploy

Configure `src/lib/site.ts` `url` to your production domain before launch so metadata, canonical URLs, and `sitemap.xml` stay correct. Images use `next/image` with `unoptimized: true` in `next.config.ts` for simpler static hosting; switch this off on Vercel if you want the image optimizer.

Point your host (Vercel, Netlify, Node server, etc.) at this directory — run `npm run build` and serve with `npm run start`, or your platform’s Next.js preset.
