/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { hasAllowedHost, hasAllowedOrigin } from "./allowed-request";
import { stripToken, tokenFromHeaders, tokenMatches } from "./lens-proxy-token";

describe("tokenFromHeaders", () => {
  it("reads a bearer token", () => {
    expect(tokenFromHeaders({ authorization: "Bearer some-token" })).toBe("some-token");
  });

  it("ignores another authorization scheme", () => {
    expect(tokenFromHeaders({ authorization: "Basic bGVuczpmYWtl" })).toBeUndefined();
  });

  it("reads the cookie among others", () => {
    expect(tokenFromHeaders({ cookie: "a=1; ims_scope_proxy_token=some-token; b=2" })).toBe("some-token");
  });

  it("reads the cookie from one of several HTTP/2 cookie fields", () => {
    expect(tokenFromHeaders({ cookie: ["a=1", "ims_scope_proxy_token=some-token"] as unknown as string })).toBe(
      "some-token",
    );
  });

  it("does not take a cookie whose name only ends like it", () => {
    expect(tokenFromHeaders({ cookie: "x_ims_scope_proxy_token=some-token" })).toBeUndefined();
  });

  it("prefers the bearer token over the cookie", () => {
    expect(tokenFromHeaders({ authorization: "Bearer from-header", cookie: "ims_scope_proxy_token=from-cookie" })).toBe(
      "from-header",
    );
  });
});

describe("stripToken", () => {
  it("removes both places the token travels in", () => {
    const headers = { authorization: "Bearer some-token", cookie: "ims_scope_proxy_token=some-token", accept: "*/*" };

    stripToken(headers);

    expect(headers).toEqual({ accept: "*/*" });
  });
});

describe("tokenMatches", () => {
  it("matches the same token", () => {
    expect(tokenMatches("some-token", "some-token")).toBe(true);
  });

  it.each([
    ["a different token", "other-token"],
    ["a prefix of it", "some-tok"],
    ["an empty string", ""],
    ["nothing", undefined],
  ])("does not match %s", (_, actual) => {
    expect(tokenMatches("some-token", actual)).toBe(false);
  });
});

describe("hasAllowedHost", () => {
  it.each([
    "127.0.0.1",
    "127.0.0.1:4321",
    "renderer.ims-scope.app:4321",
    "some-cluster-id.renderer.ims-scope.app:4321",
  ])("allows %s", (host) => {
    expect(hasAllowedHost({ host })).toBe(true);
  });

  it("reads the HTTP/2 authority", () => {
    expect(hasAllowedHost({ ":authority": "127.0.0.1:4321" } as never)).toBe(true);
  });

  it.each([
    "localhost:4321",
    "attacker.example",
    "renderer.ims-scope.app.attacker.example",
    "a.b.renderer.ims-scope.app",
    "127.0.0.1.attacker.example",
  ])("refuses %s", (host) => {
    expect(hasAllowedHost({ host })).toBe(false);
  });

  it("refuses a request without a host", () => {
    expect(hasAllowedHost({})).toBe(false);
  });
});

describe("hasAllowedOrigin", () => {
  it("allows a request from no page", () => {
    expect(hasAllowedOrigin({})).toBe(true);
  });

  it.each(["https://renderer.ims-scope.app:4321", "https://some-cluster-id.renderer.ims-scope.app:4321"])(
    "allows the frame %s",
    (origin) => {
      expect(hasAllowedOrigin({ origin })).toBe(true);
    },
  );

  it.each(["https://attacker.example", "http://renderer.ims-scope.app:4321", "null"])("refuses %s", (origin) => {
    expect(hasAllowedOrigin({ origin })).toBe(false);
  });
});
