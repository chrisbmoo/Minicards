/*
 * Minicards Worker.
 * - /admin/api/cards  → card manager API (worker/cards-api.js)
 * - everything else   → the static site built into dist/ (served by Workers static assets,
 *                       including _headers, _redirects and 404.html)
 */
import { onRequestGet, onRequestPut, onRequest } from "./cards-api.js";

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === "/admin/api/cards" || url.pathname === "/admin/api/cards/") {
      const context = { request, env, ctx };
      if (request.method === "GET" || request.method === "HEAD") return onRequestGet(context);
      if (request.method === "PUT") return onRequestPut(context);
      return onRequest(context);
    }
    return env.ASSETS.fetch(request);
  },
};
