/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import type { IncomingHttpHeaders } from "node:http";

/**
 * The hosts lens-proxy is reached under: `127.0.0.1` for kubectl, helm, the
 * terminals and the main process, and `renderer.ims-scope.app` and its
 * subdomains for the root and cluster frames. The port is not checked.
 */
const allowedHost = /^(?:127\.0\.0\.1|(?:[a-z0-9-]+\.)?renderer\.ims-scope\.app)(?::\d+)?$/i;

/**
 * The origins of the root and cluster frames. A request without an `Origin`
 * does not come from a page.
 */
const allowedOrigin = /^https:\/\/(?:[a-z0-9-]+\.)?renderer\.ims-scope\.app(?::\d+)?$/i;

const authorityOf = (headers: IncomingHttpHeaders): string | undefined => {
  const authority = (headers as Record<string, unknown>)[":authority"] ?? headers.host;

  return typeof authority === "string" ? authority : undefined;
};

/**
 * Whether the `Host` (or HTTP/2 `:authority`) is one lens-proxy serves. It
 * defeats DNS rebinding of a foreign name onto 127.0.0.1. A layer behind the
 * token, not a replacement for it.
 */
export const hasAllowedHost = (headers: IncomingHttpHeaders): boolean => {
  const authority = authorityOf(headers);

  return authority !== undefined && allowedHost.test(authority);
};

/**
 * Whether the request carries no `Origin`, or the origin of one of our frames.
 * CLI clients send none. A layer behind the `SameSite=Strict` cookie.
 */
export const hasAllowedOrigin = (headers: IncomingHttpHeaders): boolean => {
  const { origin } = headers;

  return origin === undefined || (typeof origin === "string" && allowedOrigin.test(origin));
};
