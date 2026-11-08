import test from "node:test";
import assert from "node:assert/strict";
import { isAllowedTikTokUrl, sanitizeResult } from "../src/index.js";

test("accepts standard TikTok video URL", () => {
  assert.equal(isAllowedTikTokUrl("https://www.tiktok.com/@creator/video/1234567890123456789"), true);
});

test("accepts TikTok short share URL", () => {
  assert.equal(isAllowedTikTokUrl("https://vm.tiktok.com/ZMabc123/"), true);
});

test("rejects non-TikTok and deceptive hosts", () => {
  assert.equal(isAllowedTikTokUrl("https://example.com/@creator/video/123"), false);
  assert.equal(isAllowedTikTokUrl("https://tiktok.com.example.org/@creator/video/123"), false);
  assert.equal(isAllowedTikTokUrl("javascript:alert(1)"), false);
});

test("filters non-HTTPS media URLs", () => {
  const result = sanitizeResult({
    success: true,
    platform: "tiktok",
    medias: [
      { type: "video", ext: "mp4", url: "https://cdn.example/video.mp4" },
      { type: "video", ext: "mp4", url: "http://insecure.example/video.mp4" }
    ],
    meta: { title: "Test" }
  });
  assert.equal(result.medias.length, 1);
  assert.equal(result.title, "Test");
});
