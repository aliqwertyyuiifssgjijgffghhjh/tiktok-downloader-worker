# TikTok Downloader API — Cloudflare Worker

A small backend API for a TikTok downloader website. It validates TikTok URLs and calls SaveAPI server-side. The SaveAPI key is stored as a Cloudflare Worker secret and is never sent to the browser.

## What it does

- `GET /api/health` — health check.
- `POST /api/download` — accepts `{ "url": "https://www.tiktok.com/..." }`.
- Allows TikTok's common full and short-link hosts only.
- Calls `https://api.saveapi.org/v1/download` using Bearer authentication.
- Returns sanitized metadata and HTTPS media URLs.
- Maps common provider errors and uses a 25-second upstream timeout.
- Supports exact-origin CORS configuration.
- Includes an approximate Cloudflare per-IP rate limit (10 requests per 60 seconds); shared IPs may share this limit.

This backend returns provider-hosted media URLs. It does not proxy, store, or re-host video files. Download and use content only when you own it or have permission, and comply with TikTok and provider terms. A provider's API response is not proof that a particular reuse is authorized.

## Requirements

- Node.js 20+
- A Cloudflare account
- A SaveAPI account and API key
- Wrangler CLI (installed through npm)

## 1. Configure locally

```bash
npm install
cp .dev.vars.example .dev.vars
```

Edit `.dev.vars` and replace the placeholder with your real SaveAPI key:

```dotenv
SAVEAPI_KEY="sk_live_your_real_key"
```

Do not commit `.dev.vars`, API keys, or secrets to GitHub.

## 2. Configure your website origin

Edit `wrangler.toml`:

```toml
[vars]
ALLOWED_ORIGIN = "https://yourdomain.com"
```

For local testing, the default is `http://localhost:8787`. If your frontend runs on a different local port, update this value.

## 3. Run locally

```bash
npm run dev
```

Health check:

```bash
curl http://localhost:8787/api/health
```

Test a public TikTok URL:

```bash
curl -X POST http://localhost:8787/api/download \
  -H "Content-Type: application/json" \
  -d '{"url":"https://www.tiktok.com/@creator/video/1234567890123456789"}'
```

Use a real public URL for an actual provider test. The example ID above is illustrative.

## 4. Deploy to Cloudflare

The project uses the Cloudflare Workers Rate Limiting binding and requires Wrangler 4.36.0 or later. The included limit is 10 requests per client IP per 60 seconds; Cloudflare documents this limiter as approximate and local to each Cloudflare location.

Authenticate Wrangler:

```bash
npx wrangler login
```

Set the secret (this stores it in Cloudflare, not in Git):

```bash
npx wrangler secret put SAVEAPI_KEY
```

Paste your SaveAPI key when prompted. Then deploy:

```bash
npm run deploy
```

Cloudflare will provide a `workers.dev` URL. Test:

```bash
curl https://YOUR-WORKER.YOUR-SUBDOMAIN.workers.dev/api/health
```

## 5. Connect your custom domain

In Cloudflare Dashboard:
1. Open **Workers & Pages**.
2. Select `tiktok-downloader-api`.
3. Open **Settings → Domains & Routes**.
4. Add a route or custom domain such as `api.yourdomain.com`.
5. Set `ALLOWED_ORIGIN` to the exact frontend origin, such as `https://yourdomain.com`, and deploy again.

Your frontend should call:

```js
const response = await fetch("https://api.yourdomain.com/api/download", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ url: tiktokUrl })
});
const data = await response.json();
```

## 6. Add to GitHub

Create a new empty GitHub repository, then run these commands from this project directory:

```bash
git init
git add .
git commit -m "Initial TikTok downloader Worker backend"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/YOUR_REPOSITORY.git
git push -u origin main
```

Keep `.dev.vars` out of Git. The `.gitignore` already excludes it.

## API response

Success returns a simplified structure:

```json
{
  "success": true,
  "platform": "tiktok",
  "type": "video",
  "title": "Video caption",
  "author": "Creator",
  "thumbnail": "https://...",
  "duration": 15,
  "medias": [
    {
      "type": "video",
      "ext": "mp4",
      "size_mb": 3.2,
      "url": "https://..."
    }
  ],
  "formats": [],
  "recommended_format": "nowm"
}
```

The exact fields depend on what the provider returns for the source post. TikTok photo posts may return image media rather than a video.

## Production checklist

Before making the service public:
- Confirm SaveAPI's current terms permit your intended use and redistribution.
- Configure an exact `ALLOWED_ORIGIN`; do not use `*` for a public production site.
- Review the included rate-limit binding. It is approximate and per Cloudflare location; users behind the same public IP may share a limit. Change the `namespace_id` to a positive integer unique in your Cloudflare account. Consider additional WAF rules for abuse.
- Set provider spending/credit alerts where available.
- Monitor Worker logs and provider errors.
- Consider a second provider only after testing its terms, quota, response schema, and reliability.
- Do not promise that every TikTok post is downloadable. Private, deleted, restricted, or unavailable posts will fail.
