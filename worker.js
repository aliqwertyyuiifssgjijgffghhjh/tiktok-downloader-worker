// Cloudflare Worker - TOTP Backend
// No API authentication required

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Content-Type": "application/json"
};

// ---------- Base32 ----------

const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function base32Encode(bytes) {
  let bits = 0;
  let value = 0;
  let output = "";

  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;

    while (bits >= 5) {
      output += BASE32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }

  if (bits > 0) {
    output += BASE32[(value << (5 - bits)) & 31];
  }

  return output;
}

function base32Decode(str) {
  str = str.replace(/[\s=-]/g, "").toUpperCase();

  let bits = 0;
  let value = 0;
  const output = [];

  for (const char of str) {
    const index = BASE32.indexOf(char);
    if (index === -1) continue;

    value = (value << 5) | index;
    bits += 5;

    if (bits >= 8) {
      output.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }

  return new Uint8Array(output);
}

// ---------- TOTP ----------

async function generateTOTP(secret) {
  const keyData = base32Decode(secret);

  const counter = Math.floor(Date.now() / 1000 / 30);

  const buffer = new ArrayBuffer(8);
  const view = new DataView(buffer);

  view.setUint32(0, Math.floor(counter / 0x100000000));
  view.setUint32(4, counter >>> 0);

  const key = await crypto.subtle.importKey(
    "raw",
    keyData,
    {
      name: "HMAC",
      hash: "SHA-1"
    },
    false,
    ["sign"]
  );

  const signature = new Uint8Array(
    await crypto.subtle.sign("HMAC", key, buffer)
  );

  const offset = signature[signature.length - 1] & 0x0f;

  const binary =
    ((signature[offset] & 0x7f) << 24) |
    ((signature[offset + 1] & 0xff) << 16) |
    ((signature[offset + 2] & 0xff) << 8) |
    (signature[offset + 3] & 0xff);

  return String(binary % 1000000).padStart(6, "0");
}

// ---------- Helpers ----------

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: CORS_HEADERS
  });
}

function randomSecret() {
  const bytes = crypto.getRandomValues(new Uint8Array(20));
  return base32Encode(bytes);
}

function createOtpAuth(secret, account, issuer) {
  return `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(account)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
}

// ---------- Main ----------

export default {
  async fetch(request, env) {

    // CORS
    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: CORS_HEADERS
      });
    }

    const url = new URL(request.url);

    // Health check
    if (url.pathname === "/") {
      return json({
        success: true,
        service: "TOTP Backend",
        version: "1.0.0"
      });
    }

    // ---------- Create TOTP account ----------

    if (
      request.method === "POST" &&
      url.pathname === "/api/create"
    ) {
      const body = await request.json();

      const account = String(body.account || "").trim();
      const issuer = String(body.issuer || "My Auth").trim();

      if (!account) {
        return json({
          success: false,
          error: "Account is required"
        }, 400);
      }

      const secret = randomSecret();

      const otpAuth = createOtpAuth(
        secret,
        account,
        issuer
      );

      const id = crypto.randomUUID();

      await env.TOTP_KV.put(
        `totp:${id}`,
        JSON.stringify({
          id,
          account,
          issuer,
          secret,
          created_at: Date.now()
        })
      );

      return json({
        success: true,
        id,
        account,
        issuer,
        secret,
        otp_auth: otpAuth
      });
    }

    // ---------- Generate TOTP code ----------

    if (
      request.method === "POST" &&
      url.pathname === "/api/code"
    ) {
      const body = await request.json();

      const id = String(body.id || "");

      if (!id) {
        return json({
          success: false,
          error: "Account ID required"
        }, 400);
      }

      const data = await env.TOTP_KV.get(`totp:${id}`);

      if (!data) {
        return json({
          success: false,
          error: "Account not found"
        }, 404);
      }

      const account = JSON.parse(data);

      const code = await generateTOTP(account.secret);

      const now = Math.floor(Date.now() / 1000);
      const remaining = 30 - (now % 30);

      return json({
        success: true,
        id,
        account: account.account,
        issuer: account.issuer,
        code,
        expires_in: remaining
      });
    }

    // ---------- Get account information ----------

    if (
      request.method === "GET" &&
      url.pathname === "/api/account"
    ) {
      const id = url.searchParams.get("id");

      if (!id) {
        return json({
          success: false,
          error: "ID required"
        }, 400);
      }

      const data = await env.TOTP_KV.get(`totp:${id}`);

      if (!data) {
        return json({
          success: false,
          error: "Account not found"
        }, 404);
      }

      const account = JSON.parse(data);

      return json({
        success: true,
        id: account.id,
        account: account.account,
        issuer: account.issuer,
        created_at: account.created_at
      });
    }

    // ---------- Delete account ----------

    if (
      request.method === "DELETE" &&
      url.pathname === "/api/delete"
    ) {
      const body = await request.json();

      const id = String(body.id || "");

      if (!id) {
        return json({
          success: false,
          error: "ID required"
        }, 400);
      }

      await env.TOTP_KV.delete(`totp:${id}`);

      return json({
        success: true,
        message: "Account deleted"
      });
    }

    // ---------- Unknown endpoint ----------

    return json({
      success: false,
      error: "Endpoint not found"
    }, 404);
  }
};
