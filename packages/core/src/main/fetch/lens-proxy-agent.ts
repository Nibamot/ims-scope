/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { Agent } from "undici";

import type { Dispatcher } from "undici";

const agents = new Map<string, Agent>();

/**
 * A dispatcher that trusts the self-signed lens-proxy certificate.
 *
 * undici pools sockets per dispatcher, so — unlike the `https.Agent` this
 * replaces — a fresh one per request would leak connections. The certificate is
 * generated once per process, so one dispatcher per certificate is enough.
 */
export const getLensProxyAgent = (ca: string | undefined): Dispatcher => {
  const key = ca ?? "";
  const existing = agents.get(key);

  if (existing) {
    return existing;
  }

  const agent = new Agent({ connect: { ca } });

  agents.set(key, agent);

  return agent;
};

type DispatchHeaders = Dispatcher.DispatchOptions["headers"];

const isAuthorization = (name: unknown) => String(name).toLowerCase() === "authorization";

/**
 * The headers with `Authorization` set to the bearer token, replacing any
 * already there, in the shape undici was given them: a flat array, an iterable
 * of pairs, or an object.
 */
const withAuthorization = (headers: DispatchHeaders, token: string): DispatchHeaders => {
  const authorization = `Bearer ${token}`;

  if (!headers) {
    return { authorization };
  }

  if (Array.isArray(headers)) {
    const kept: string[] = [];

    for (let i = 0; i < headers.length; i += 2) {
      if (!isAuthorization(headers[i])) {
        kept.push(headers[i], headers[i + 1]);
      }
    }

    kept.push("authorization", authorization);

    return kept;
  }

  if (Symbol.iterator in headers) {
    const kept = [...(headers as Iterable<[string, unknown]>)].filter(([name]) => !isAuthorization(name));

    return [...kept, ["authorization", authorization]] as unknown as DispatchHeaders;
  }

  const kept = Object.fromEntries(Object.entries(headers).filter(([name]) => !isAuthorization(name)));

  return { ...kept, authorization };
};

/**
 * Adds `Authorization: Bearer <token>` to every request whose origin
 * `isLensProxyOrigin` accepts, so the main process carries the lens-proxy token
 * the way kubectl and helm do. Any other origin is left alone, so an API
 * client pointed elsewhere through this dispatcher cannot leak the token.
 */
export const withBearerToken =
  (token: string, isLensProxyOrigin: (origin: string) => boolean): Dispatcher.DispatcherComposeInterceptor =>
  (dispatch) =>
  (options, handler) =>
    isLensProxyOrigin(String(options.origin ?? ""))
      ? dispatch({ ...options, headers: withAuthorization(options.headers, token) }, handler)
      : dispatch(options, handler);
