/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { createServer, type Server } from "node:http";
import { Agent, request } from "undici";
import { withBearerToken } from "./lens-proxy-agent";
import { isLensProxyOrigin } from "./lens-proxy-dispatcher.injectable";
import type { AddressInfo } from "node:net";

describe("withBearerToken", () => {
  let server: Server;
  let origin: string;
  let received: string | undefined;

  beforeEach(async () => {
    server = createServer((req, res) => {
      received = req.headers.authorization;
      res.end();
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    received = undefined;
  });

  afterEach(async () => {
    await new Promise((resolve) => server.close(resolve));
  });

  const send = async (isLensProxy: boolean, headers?: Record<string, string> | string[]) => {
    const dispatcher = new Agent().compose(withBearerToken("some-token", () => isLensProxy));
    const response = await request(`${origin}/some-path`, { dispatcher, headers });

    await response.body.dump();

    return received;
  };

  it("adds the token to a request for lens-proxy", async () => {
    expect(await send(true)).toBe("Bearer some-token");
  });

  it("replaces an authorization the caller gave, as an object", async () => {
    expect(await send(true, { Authorization: "Basic something" })).toBe("Bearer some-token");
  });

  it("replaces an authorization the caller gave, as a flat list", async () => {
    expect(await send(true, ["authorization", "Basic something", "accept", "*/*"])).toBe("Bearer some-token");
  });

  it("leaves a request for any other origin alone", async () => {
    expect(await send(false)).toBeUndefined();
  });
});

describe("isLensProxyOrigin", () => {
  it.each([
    "https://127.0.0.1:4321",
    "https://renderer.ims-scope.app:4321",
    "https://some-id.renderer.ims-scope.app:4321",
  ])("accepts %s", (origin) => {
    expect(isLensProxyOrigin(origin)).toBe(true);
  });

  it.each(["http://127.0.0.1:4321", "https://example.com", "https://localhost:4321", "", "not a url"])(
    "refuses %s",
    (origin) => {
      expect(isLensProxyOrigin(origin)).toBe(false);
    },
  );
});
