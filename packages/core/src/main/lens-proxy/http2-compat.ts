/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import type http from "node:http";

/**
 * The proxy serves HTTP/2 so that Chromium multiplexes every request a cluster
 * frame makes over one connection. Over HTTP/1.1 Chromium allows only six
 * connections per host, and each long-lived watch holds one for minutes, so a
 * view subscribed to six or more stores left every other request -- pod logs,
 * a resource's YAML -- queued until it timed out.
 *
 * The rest of the proxy (cluster lookup, the router, http-proxy) was written
 * against HTTP/1 messages. The two helpers below adapt an HTTP/2 compatibility
 * request and an upstream HTTP/1.1 response at that boundary.
 */

interface MaybeHttp2Request {
  httpVersionMajor: number;
  url?: string;
  method?: string;
  headers: http.IncomingHttpHeaders;
}

/**
 * Connection-specific headers that HTTP/2 forbids (RFC 9113 section 8.2.2).
 * Node resets the stream with ERR_HTTP2_INVALID_CONNECTION_HEADERS if any of
 * them is written to an HTTP/2 response.
 */
const connectionSpecificHeaders = new Set([
  "connection",
  "keep-alive",
  "proxy-connection",
  "transfer-encoding",
  "upgrade",
]);

/**
 * Makes an HTTP/2 request look like the HTTP/1 request the rest of the proxy
 * expects. A no-op for HTTP/1 requests.
 *
 * - `host` is set from `:authority`, which is where HTTP/2 carries it; cluster
 *   lookup routes on it.
 * - The pseudo-headers (`:method`, `:path`, ...) are removed, because
 *   http-proxy copies every request header onto its outgoing HTTP/1.1 request
 *   and Node rejects a header name starting with a colon.
 * - `url` and `method` are pinned as own properties first: the compatibility
 *   request reads them from `:path` and `:method`, so removing those would
 *   otherwise blank them, and the proxy rewrites `url` in place.
 */
export function normalizeHttp2Request(req: MaybeHttp2Request): void {
  if (req.httpVersionMajor !== 2) {
    return;
  }

  const { url, method } = req;
  const authority = req.headers[":authority"];

  if (!req.headers.host && typeof authority === "string") {
    req.headers.host = authority;
  }

  Object.defineProperty(req, "url", { value: url, writable: true, configurable: true, enumerable: true });
  Object.defineProperty(req, "method", { value: method, writable: true, configurable: true, enumerable: true });

  for (const name of Object.keys(req.headers)) {
    if (name.startsWith(":")) {
      delete req.headers[name];
    }
  }
}

/**
 * Strips what an HTTP/2 response cannot carry from an upstream HTTP/1.1
 * response, before http-proxy copies it onto the client's response: the
 * connection-specific headers, and the status message (HTTP/2 has none, and
 * Node warns on every response that sets one). A no-op for HTTP/1 requests.
 */
export function adaptUpstreamResponseForHttp2(
  req: Pick<MaybeHttp2Request, "httpVersionMajor">,
  proxyRes: http.IncomingMessage,
): void {
  if (req.httpVersionMajor !== 2) {
    return;
  }

  for (const name of connectionSpecificHeaders) {
    delete proxyRes.headers[name];
  }

  const rawHeaders: string[] = [];

  for (let i = 0; i < proxyRes.rawHeaders.length; i += 2) {
    if (!connectionSpecificHeaders.has(proxyRes.rawHeaders[i].toLowerCase())) {
      rawHeaders.push(proxyRes.rawHeaders[i], proxyRes.rawHeaders[i + 1]);
    }
  }

  proxyRes.rawHeaders = rawHeaders;
  proxyRes.statusMessage = "";
}
