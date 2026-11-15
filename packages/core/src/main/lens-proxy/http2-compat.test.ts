/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { adaptUpstreamResponseForHttp2, normalizeHttp2Request } from "./http2-compat";
import type http from "node:http";

/**
 * Models the HTTP/2 compatibility request: `url` and `method` are accessors
 * over the `:path` and `:method` pseudo-headers, as they are in Node.
 */
function makeHttp2Request(headers: http.IncomingHttpHeaders) {
  return {
    httpVersionMajor: 2,
    headers,
    get url() {
      return this.headers[":path"] as string | undefined;
    },
    set url(value) {
      this.headers[":path"] = value;
    },
    get method() {
      return this.headers[":method"] as string | undefined;
    },
  };
}

function makeUpstreamResponse(rawHeaders: string[]) {
  const headers: http.IncomingHttpHeaders = {};

  for (let i = 0; i < rawHeaders.length; i += 2) {
    headers[rawHeaders[i].toLowerCase()] = rawHeaders[i + 1];
  }

  return { headers, rawHeaders, statusMessage: "OK" } as unknown as http.IncomingMessage;
}

describe("normalizeHttp2Request", () => {
  it("sets host from :authority and removes the pseudo-headers", () => {
    const req = makeHttp2Request({
      ":method": "GET",
      ":path": "/api-kube/api/v1/pods?watch=1",
      ":authority": "some-cluster-id.renderer.ims-scope.app:1234",
      ":scheme": "https",
      accept: "application/json",
    });

    normalizeHttp2Request(req);

    expect(req.headers).toEqual({
      host: "some-cluster-id.renderer.ims-scope.app:1234",
      accept: "application/json",
    });
  });

  it("keeps url and method, which would otherwise be read from the removed pseudo-headers", () => {
    const req = makeHttp2Request({ ":method": "PATCH", ":path": "/some/path", ":authority": "some-host" });

    normalizeHttp2Request(req);

    expect(req.url).toBe("/some/path");
    expect(req.method).toBe("PATCH");
  });

  it("leaves url writable, since the proxy rewrites it in place", () => {
    const req = makeHttp2Request({ ":method": "GET", ":path": "/api-kube/api/v1/pods", ":authority": "some-host" });

    normalizeHttp2Request(req);
    req.url = "/api/v1/pods";

    expect(req.url).toBe("/api/v1/pods");
  });

  it("keeps an explicit host header over :authority", () => {
    const req = makeHttp2Request({ ":path": "/", ":authority": "from-authority", host: "from-host" });

    normalizeHttp2Request(req);

    expect(req.headers.host).toBe("from-host");
  });

  it("does nothing to an HTTP/1 request", () => {
    const req = { httpVersionMajor: 1, url: "/some/path", method: "GET", headers: { host: "some-host" } };

    normalizeHttp2Request(req);

    expect(req).toEqual({ httpVersionMajor: 1, url: "/some/path", method: "GET", headers: { host: "some-host" } });
  });
});

describe("adaptUpstreamResponseForHttp2", () => {
  const upstreamRawHeaders = [
    "Content-Type",
    "application/json",
    "Connection",
    "keep-alive",
    "Keep-Alive",
    "timeout=5",
    "Transfer-Encoding",
    "chunked",
    "Audit-Id",
    "some-audit-id",
  ];

  it("strips connection-specific headers and the status message for an HTTP/2 request", () => {
    const proxyRes = makeUpstreamResponse([...upstreamRawHeaders]);

    adaptUpstreamResponseForHttp2({ httpVersionMajor: 2 }, proxyRes);

    expect(proxyRes.rawHeaders).toEqual(["Content-Type", "application/json", "Audit-Id", "some-audit-id"]);
    expect(proxyRes.headers).toEqual({ "content-type": "application/json", "audit-id": "some-audit-id" });
    expect(proxyRes.statusMessage).toBe("");
  });

  it("does nothing for an HTTP/1 request", () => {
    const proxyRes = makeUpstreamResponse([...upstreamRawHeaders]);

    adaptUpstreamResponseForHttp2({ httpVersionMajor: 1 }, proxyRes);

    expect(proxyRes.rawHeaders).toEqual(upstreamRawHeaders);
    expect(proxyRes.statusMessage).toBe("OK");
  });
});
