const SAVEAPI_ENDPOINT = "https://api.saveapi.org/v1/download";
const MAX_URL_LENGTH = 2048;
const REQUEST_TIMEOUT_MS = 25000;

const ALLOWED_TIKTOK_HOSTS = new Set([
  "tiktok.com",
  "www.tiktok.com",
  "m.tiktok.com",
  "vm.tiktok.com",
  "vt.tiktok.com"
]);

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      ...headers
    }
  });
}

function corsHeaders(request, env) {
  const origin = request.headers.get("Origin");
  const allowed = env.ALLOWED_ORIGIN || "";
  // In production configure one exact origin. Local curl/no-Origin requests are allowed.
  if (!origin) return {};
  if (allowed === "*" || origin === allowed) {
    return {
      "access-control-allow-origin": allowed === "*" ? "*" : origin,
      "vary": "Origin",
      "access-control-allow-methods": "POST, GET, OPTIONS",
      "access-control-allow-headers": "Content-Type",
      "access-control-max-age": "86400"
    };
  }
  return null;
}

function isAllowedTikTokUrl(input) {
  if (typeof input !== "string" || input.length < 12 || input.length > MAX_URL_LENGTH) {
    return false;
  }
  try {
    const parsed = new URL(input);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return false;
    if (parsed.username || parsed.password || parsed.port) return false;
    if (!ALLOWED_TIKTOK_HOSTS.has(parsed.hostname.toLowerCase())) return false;
    if (parsed.hostname === "tiktok.com" || parsed.hostname === "www.tiktok.com" ||
        parsed.hostname === "m.tiktok.com") {
      return /^\/@[^/]+\/(video|photo)\/\d+/.test(parsed.pathname) ||
             /^\/t\/[A-Za-z0-9_-]+/.test(parsed.pathname);
    }
    // TikTok share domains use short redirect paths. They are passed only to SaveAPI;
    // this Worker does not follow user-controlled redirects.
    return /^\/[A-Za-z0-9_-]+\/?$/.test(parsed.pathname);
  } catch {
    return false;
  }
}

function normalizeProviderError(providerStatus, providerBody) {
  const code = providerBody?.error?.code || "UPSTREAM_ERROR";
  const safeMessages = {
    INVALID_URL: "The TikTok link is invalid.",
    UNSUPPORTED_PLATFORM: "This link is not supported.",
    PRIVATE_CONTENT: "This video is private or unavailable for public access.",
    MEDIA_NOT_FOUND: "No downloadable media was found. The video may be deleted or restricted.",
    RATE_LIMITED: "The API provider is temporarily rate-limited. Please try again later.",
    QUOTA_EXCEEDED: "The API provider has run out of credits.",
    PLATFORM_NOT_ALLOWED: "The API provider account does not have access to this platform.",
    UPSTREAM_TIMEOUT: "TikTok did not respond in time. Please try again.",
    UPSTREAM_ERROR: "The video provider could not process this link."
  };
  const statusMap = {
    INVALID_URL: 400,
    UNSUPPORTED_PLATFORM: 400,
    PRIVATE_CONTENT: 403,
    PLATFORM_NOT_ALLOWED: 403,
    MEDIA_NOT_FOUND: 404,
    RATE_LIMITED: 429,
    QUOTA_EXCEEDED: 503,
    UPSTREAM_TIMEOUT: 504,
    UPSTREAM_ERROR: 502
  };
  return {
    status: statusMap[code] || (providerStatus >= 500 ? 502 : 400),
    body: { success: false, error: { code, message: safeMessages[code] || "The provider rejected this request." } }
  };
}

function sanitizeResult(data) {
  if (!data || data.success !== true || !Array.isArray(data.medias)) return null;

  const media = data.medias
    .filter(item => item && typeof item.url === "string" && /^https:\/\//i.test(item.url))
    .map(item => ({
      type: typeof item.type === "string" ? item.type : "unknown",
      ext: typeof item.ext === "string" ? item.ext : null,
      size_mb: Number.isFinite(item.size_mb) ? item.size_mb : null,
      url: item.url
    }));

  const formats = Array.isArray(data.formats)
    ? data.formats
        .filter(item => item && typeof item.url === "string" && /^https:\/\//i.test(item.url))
        .map(item => ({
          format: typeof item.format === "string" ? item.format : null,
          label: typeof item.label === "string" ? item.label : null,
          type: typeof item.type === "string" ? item.type : "unknown",
          size_mb: Number.isFinite(item.size_mb) ? item.size_mb : null,
          url: item.url
        }))
    : [];

  if (media.length === 0 && formats.length === 0) return null;

  const meta = data.meta && typeof data.meta === "object" ? data.meta : {};
  return {
    success: true,
    platform: data.platform || "tiktok",
    type: data.type || "unknown",
    title: typeof meta.title === "string" ? meta.title.slice(0, 500) : "",
    author: typeof meta.author === "string" ? meta.author.slice(0, 120) : "",
    thumbnail: typeof meta.thumbnail === "string" && /^https:\/\//i.test(meta.thumbnail) ? meta.thumbnail : null,
    duration: Number.isFinite(meta.duration) ? meta.duration : null,
    medias: media,
    formats,
    recommended_format: typeof data.recommended_format === "string" ? data.recommended_format : null,
    note: "Use these media links only when you have the rights or permission to download and use the content."
  };
}

async function handleDownload(request, env) {
  if (!env.SAVEAPI_KEY) {
    return json({ success: false, error: { code: "SERVER_NOT_CONFIGURED", message: "The download service is not configured yet." } }, 503);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ success: false, error: { code: "INVALID_JSON", message: "Send a valid JSON body." } }, 400);
  }

  const inputUrl = body?.url;
  if (!isAllowedTikTokUrl(inputUrl)) {
    return json({ success: false, error: { code: "INVALID_TIKTOK_URL", message: "Paste a valid public TikTok video or photo link." } }, 400);
  }

  const providerUrl = new URL(SAVEAPI_ENDPOINT);
  providerUrl.searchParams.set("url", inputUrl);

  let upstream;
  try {
    upstream = await fetch(providerUrl.toString(), {
      method: "GET",
      headers: {
        "Authorization": `Bearer ${env.SAVEAPI_KEY}`,
        "Accept": "application/json"
      },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    });
  } catch (error) {
    const timedOut = error?.name === "TimeoutError";
    return json({
      success: false,
      error: {
        code: timedOut ? "UPSTREAM_TIMEOUT" : "UPSTREAM_UNAVAILABLE",
        message: timedOut ? "The video provider took too long to respond." : "The video provider is temporarily unavailable."
      }
    }, timedOut ? 504 : 502);
  }

  let data;
  try {
    data = await upstream.json();
  } catch {
    return json({ success: false, error: { code: "INVALID_PROVIDER_RESPONSE", message: "The video provider returned an invalid response." } }, 502);
  }

  if (!upstream.ok || data?.success !== true) {
    const mapped = normalizeProviderError(upstream.status, data);
    const response = json(mapped.body, mapped.status);
    const retryAfter = upstream.headers.get("Retry-After");
    if (retryAfter) response.headers.set("Retry-After", retryAfter);
    return response;
  }

  const result = sanitizeResult(data);
  if (!result) {
    return json({ success: false, error: { code: "NO_MEDIA", message: "The provider did not return usable media links." } }, 502);
  }

  return json(result, 200, {
    "x-provider": "saveapi",
    ...(upstream.headers.get("X-Credits-Remaining")
      ? { "x-provider-credits-remaining": upstream.headers.get("X-Credits-Remaining") }
      : {})
  });
}

export default {
  async fetch(request, env) {
    const cors = corsHeaders(request, env);
    if (cors === null) {
      return json({ success: false, error: { code: "ORIGIN_NOT_ALLOWED", message: "This website origin is not allowed." } }, 403);
    }

    const url = new URL(request.url);
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors || {} });
    }

    if (url.pathname === "/api/health" && request.method === "GET") {
      return json({ success: true, service: "TikTok Downloader API", status: "ok" }, 200, cors || {});
    }

    if (url.pathname === "/api/download" && request.method === "POST") {
      const contentType = request.headers.get("Content-Type") || "";
      if (!contentType.toLowerCase().includes("application/json")) {
        return json({ success: false, error: { code: "CONTENT_TYPE_REQUIRED", message: "Use application/json." } }, 415, cors || {});
      }
      // Cloudflare's approximate per-location limiter. In local dev the binding may be absent.
      if (env.DOWNLOAD_LIMITER) {
        const clientKey = request.headers.get("CF-Connecting-IP") || "unknown-client";
        const { success } = await env.DOWNLOAD_LIMITER.limit({ key: clientKey });
        if (!success) {
          return json({ success: false, error: { code: "RATE_LIMITED", message: "Too many requests. Please wait a minute and try again." } }, 429, { ...(cors || {}), "retry-after": "60" });
        }
      }
      const response = await handleDownload(request, env);
      const headers = new Headers(response.headers);
      for (const [key, value] of Object.entries(cors || {})) headers.set(key, value);
      return new Response(response.body, { status: response.status, headers });
    }

    return json({ success: false, error: { code: "NOT_FOUND", message: "Endpoint not found." } }, 404, cors || {});
  }
};

export { isAllowedTikTokUrl, sanitizeResult };
