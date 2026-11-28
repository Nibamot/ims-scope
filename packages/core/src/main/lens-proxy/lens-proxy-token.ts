/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { createHash, timingSafeEqual } from "node:crypto";
import type { IncomingHttpHeaders } from "node:http";

/**
 * The cookie the root and cluster frames carry the token in. Their own fetches,
 * module loads and WebSockets cannot be given a header by renderer code, so the
 * window's session holds the token as an `HttpOnly` cookie instead. kubectl,
 * helm, terminals and the main process send `Authorization: Bearer`.
 */
export const lensProxyTokenCookie = "ims_scope_proxy_token";

/**
 * The environment variable the `credential` subcommand of freelens-k8s-proxy
 * reads. The proxy kubeconfig names that subcommand as its `exec` plugin, so
 * every kubectl, helm and terminal started with it in its environment sends the
 * token as `Authorization: Bearer`, and the kubeconfig file never holds it. The
 * name is fixed by the binary.
 */
export const lensProxyTokenEnvVar = "FREELENS_PROXY_TOKEN";

const bearerPrefix = "Bearer ";

function bearerToken(headers: IncomingHttpHeaders): string | undefined {
  const { authorization } = headers;

  if (typeof authorization === "string" && authorization.startsWith(bearerPrefix)) {
    return authorization.slice(bearerPrefix.length);
  }

  return undefined;
}

function cookieToken(headers: IncomingHttpHeaders): string | undefined {
  // Over HTTP/2 the cookies may arrive as several `cookie` fields.
  const cookieHeader = headers.cookie as string | string[] | undefined;
  const cookies = Array.isArray(cookieHeader) ? cookieHeader : cookieHeader ? [cookieHeader] : [];

  for (const cookie of cookies) {
    for (const pair of cookie.split(";")) {
      const index = pair.indexOf("=");

      if (index > 0 && pair.slice(0, index).trim() === lensProxyTokenCookie) {
        return pair.slice(index + 1).trim();
      }
    }
  }

  return undefined;
}

/**
 * The token a request carries: from `Authorization: Bearer`, or from the cookie
 * for a request of a frame.
 */
export function tokenFromHeaders(headers: IncomingHttpHeaders): string | undefined {
  return bearerToken(headers) ?? cookieToken(headers);
}

/**
 * Removes the token from a request before it is forwarded towards a cluster, so
 * it never leaves the main process. The cluster reads neither header.
 */
export function stripToken(headers: IncomingHttpHeaders): void {
  delete headers.authorization;
  delete headers.cookie;
}

/**
 * Whether `actual` is `expected`, compared in constant time. Both sides are
 * hashed first, so `timingSafeEqual` always compares two buffers of one length
 * and the time taken reveals neither the length nor the content of `actual`. A
 * missing or empty `actual` matches nothing.
 */
export function tokenMatches(expected: string, actual: string | undefined): boolean {
  if (!actual) {
    return false;
  }

  const expectedHash = createHash("sha256").update(expected).digest();
  const actualHash = createHash("sha256").update(actual).digest();

  return timingSafeEqual(expectedHash, actualHash);
}
