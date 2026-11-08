# TikTok Downloader Worker — Multi-provider v2

Cloudflare Worker backend with SaveAPI + Yoinku adapters, sequential provider failover, multiple authorized credentials per provider, AES-GCM encrypted D1 storage, admin dashboard, usage/error history, cooldowns, URL validation, CORS and rate limiting.

## Deploy
1. Install and authenticate: `npm install && npx wrangler login`.
2. Create D1: `npm run db:create`; copy the returned ID into `wrangler.toml`.
3. Apply schema: `npm run db:migrate:remote`.
4. Set secrets: `npx wrangler secret put ADMIN_TOKEN` and `npx wrangler secret put KEY_ENCRYPTION_SECRET`. Use different strong random secrets; encryption secret must be 32+ characters and backed up safely.
5. Set `ALLOWED_ORIGINS` to your exact website origin(s) in wrangler.toml.
6. Deploy: `npm run deploy`.
7. Visit `https://YOUR-WORKER.workers.dev/admin`, enter ADMIN_TOKEN, and add provider keys.

## Endpoints
- GET /api/health
- POST /api/download with JSON body { "url": "https://www.tiktok.com/@creator/video/..." }
- GET /admin
- Admin APIs under /admin/api/* require X-Admin-Token.

## Provider integrations
SaveAPI: GET https://api.saveapi.org/v1/download?url=... with Authorization: Bearer KEY. Docs: https://saveapi.org/en/docs/
Yoinku: GET https://yoinku.com/api/v1/info?url=..., then GET https://yoinku.com/api/v1/download?url=...&format=ID with x-api-key. Docs: https://yoinku.com/en/api

## Important
Provider response formats and terms can change; live requests with your own API credentials are required to verify them. The backend records request counts and errors but does not claim to know providers' remaining account credits unless they expose a quota API. If a provider returns 429, that credential is cooled down and the request may fail over to a different provider; it does NOT cycle sibling credentials to bypass the same provider's limits. Use only credentials/accounts you are authorized to use and only download content you own or have permission to use. Private/deleted/restricted posts can fail.

## Security
Secrets are never committed to GitHub. Provider keys are AES-GCM encrypted before D1 storage. If KEY_ENCRYPTION_SECRET is lost, encrypted keys cannot be decrypted. Keep admin access private; add Cloudflare Access/WAF protections for /admin and rate-limit public endpoints. Configure production origins exactly.
