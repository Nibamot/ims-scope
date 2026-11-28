/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { once } from "node:events";
import net from "node:net";
import directoryForTempInjectable from "../../common/app-paths/directory-for-temp/directory-for-temp.injectable";
import directoryForUserDataInjectable from "../../common/app-paths/directory-for-user-data/directory-for-user-data.injectable";
import { getDiForUnitTesting } from "../getDiForUnitTesting";
import routerInjectable from "../router/router.injectable";
import getClusterForRequestInjectable from "./get-cluster-for-request.injectable";
import lensProxyInjectable from "./lens-proxy.injectable";
import lensProxyPortInjectable from "./lens-proxy-port.injectable";
import lensProxyTokenInjectable from "./lens-proxy-token.injectable";
import kubeApiUpgradeRequestInjectable from "./proxy-functions/kube-api-upgrade-request.injectable";
import shellApiRequestInjectable from "./proxy-functions/shell-api-request.injectable";
import type http from "node:http";

import type { DiContainer } from "@ogre-tools/injectable";
import type { Mock } from "vitest";

import type { Cluster } from "../../common/cluster/cluster";
import type { Router } from "../router/router";
import type { ServerIncomingMessage } from "./lens-proxy";

/**
 * The certificate is a placeholder in unit tests and the real RSA keygen is
 * mocked away, so the TLS server cannot be created. Nothing here needs TLS:
 * the upgrade handler is registered on the server object, and the HTTP/1.1
 * path the secure server keeps open with `allowHTTP1` is what these tests
 * drive, both of which a plain http server models exactly. The HTTP/2
 * adaptation is covered by `http2-compat.test.ts`.
 */
vi.mock("node:http2", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:http2")>();
  const http = await import("node:http");
  const createSecureServer = (_options: unknown, handler: Parameters<typeof http.createServer>[1]) =>
    http.createServer(handler);

  return { ...actual, createSecureServer, default: { ...actual, createSecureServer } };
});

describe("closing the lens proxy", () => {
  let di: DiContainer;
  let proxy: { listen: () => Promise<void>; close: () => Promise<void> | undefined };
  let port: number;
  let requestReachedTheRouter: Promise<void>;
  const sockets: net.Socket[] = [];
  const answeredPath = "/some-answered-path";

  const connect = async () => {
    const socket = net.connect(port, "127.0.0.1");

    sockets.push(socket);
    await once(socket, "connect");

    return socket;
  };

  const request = (socket: net.Socket, path: string) => {
    socket.write(`GET ${path} HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n`);
  };

  /**
   * Reads until the end of the response head, which for the answered route is
   * the whole response.
   */
  const readResponse = async (socket: net.Socket) => {
    let response = "";

    while (!response.includes("\r\n\r\n")) {
      const [chunk] = (await once(socket, "data")) as [Buffer];

      response += chunk.toString();
    }

    return response;
  };

  beforeEach(async () => {
    di = getDiForUnitTesting();

    di.override(directoryForUserDataInjectable, () => "/some-directory-for-user-data");
    di.override(directoryForTempInjectable, () => "/some-directory-for-tmp");
    di.override(getClusterForRequestInjectable, () => () => undefined);
    // Not exercised here, and instantiating them for real pulls in the whole
    // shell session graph
    di.override(shellApiRequestInjectable, () => vi.fn());
    di.override(kubeApiUpgradeRequestInjectable, () => vi.fn());

    // Every route but one never answers, standing in for the watch and follow
    // requests the proxy really carries: a connection that is not idle and
    // will not become idle on its own. The one that does answer leaves behind
    // a genuinely idle keep-alive connection.
    let requestReceived: () => void;

    requestReachedTheRouter = new Promise<void>((resolve) => {
      requestReceived = resolve;
    });
    di.override(
      routerInjectable,
      () =>
        ({
          // Closing is under test here, not the token.
          isServedWithoutToken: () => true,
          route: (_cluster: Cluster | undefined, req: ServerIncomingMessage, res: http.ServerResponse) => {
            if (req.url === answeredPath) {
              res.end();

              return Promise.resolve();
            }

            requestReceived();

            return new Promise<void>(() => {});
          },
        }) as unknown as Router,
    );

    proxy = di.inject(lensProxyInjectable);

    await proxy.listen();
    port = di.inject(lensProxyPortInjectable).get();
  });

  afterEach(() => {
    for (const socket of sockets) {
      socket.destroy();
    }

    sockets.length = 0;
  });

  it("resolves when nothing is connected", async () => {
    await expect(proxy.close()).resolves.toBeUndefined();
  });

  it("resolves without waiting out the grace period when a connection is idle", async () => {
    const socket = await connect();

    /**
     * The request has to be driven to completion for this to test anything:
     * Node only tracks a connection from the moment a message begins on it, so
     * a socket that has merely been accepted is invisible to
     * `closeIdleConnections` and would be reaped by the forced destroy
     * instead. What is idle is the keep-alive connection left behind by an
     * answered request.
     */
    request(socket, answeredPath);
    await readResponse(socket);

    const startedAt = performance.now();

    await proxy.close();

    expect(performance.now() - startedAt).toBeLessThan(400);
  });

  it("destroys a connection that is still serving a request, once the grace period is up", async () => {
    const socket = await connect();
    const socketClosed = once(socket, "close");

    request(socket, "/some-path");
    await requestReachedTheRouter;

    const startedAt = performance.now();

    await proxy.close();

    // The request never answers, so the only way this resolved is the grace
    // period elapsing and the connection being destroyed
    expect(performance.now() - startedAt).toBeGreaterThanOrEqual(400);
    await socketClosed;
  });

  it("does nothing on a second call", async () => {
    await proxy.close();

    expect(proxy.close()).toBeUndefined();
  });
});

describe("lens proxy upgrade requests", () => {
  let di: DiContainer;
  let cluster: Cluster | undefined;
  let shellApiRequest: Mock;
  let kubeApiUpgradeRequest: Mock;
  let socket: { destroy: Mock; end: Mock };

  const validHeaders = () => ({
    host: "127.0.0.1:1234",
    authorization: `Bearer ${di.inject(lensProxyTokenInjectable).value}`,
  });

  const upgrade = (url: string, headers: http.IncomingHttpHeaders = validHeaders()) => {
    const proxy = di.inject(lensProxyInjectable);
    // The upgrade handler is what is under test, and it runs long before the
    // server is listening.
    const server = (proxy as unknown as { proxyServer: NodeJS.EventEmitter }).proxyServer;
    const req = { url, method: "GET", headers } as ServerIncomingMessage;

    server.emit("upgrade", req, socket, Buffer.from([]));

    return req;
  };

  beforeEach(() => {
    di = getDiForUnitTesting();

    di.override(directoryForUserDataInjectable, () => "/some-directory-for-user-data");
    di.override(directoryForTempInjectable, () => "/some-directory-for-tmp");

    cluster = { id: "some-cluster-id" } as Cluster;
    shellApiRequest = vi.fn();
    kubeApiUpgradeRequest = vi.fn();
    socket = { destroy: vi.fn(), end: vi.fn() };

    di.override(getClusterForRequestInjectable, () => () => cluster);
    di.override(shellApiRequestInjectable, () => shellApiRequest);
    di.override(kubeApiUpgradeRequestInjectable, () => kubeApiUpgradeRequest);
  });

  describe("when there is a cluster for the request", () => {
    it("routes an internal request to the shell api", () => {
      upgrade("/api?id=some-tab-id");

      expect(shellApiRequest).toHaveBeenCalledTimes(1);
      expect(kubeApiUpgradeRequest).not.toHaveBeenCalled();
      expect(socket.destroy).not.toHaveBeenCalled();
    });

    it("routes anything else to the kube api, with the cluster", () => {
      upgrade("/api-kube/api/v1/namespaces/default/pods/some-pod/exec");

      expect(kubeApiUpgradeRequest).toHaveBeenCalledWith(expect.objectContaining({ cluster }));
      expect(shellApiRequest).not.toHaveBeenCalled();
      expect(socket.destroy).not.toHaveBeenCalled();
    });
  });

  describe("when there is no cluster for the request", () => {
    beforeEach(() => {
      cluster = undefined;
    });

    it("still routes an internal request to the shell api, without a cluster", () => {
      upgrade("/api?id=some-tab-id&type=standalone");

      expect(shellApiRequest).toHaveBeenCalledWith(expect.objectContaining({ cluster: undefined }));
      expect(socket.destroy).not.toHaveBeenCalled();
    });

    it("destroys any other upgrade request", () => {
      upgrade("/api-kube/api/v1/namespaces/default/pods/some-pod/exec");

      expect(socket.destroy).toHaveBeenCalledTimes(1);
      expect(kubeApiUpgradeRequest).not.toHaveBeenCalled();
      expect(shellApiRequest).not.toHaveBeenCalled();
    });
  });

  describe("the token", () => {
    const expectRefused = () => {
      expect(socket.end).toHaveBeenCalledWith(expect.stringMatching(/^HTTP\/1\.1 403 /));
      expect(shellApiRequest).not.toHaveBeenCalled();
      expect(kubeApiUpgradeRequest).not.toHaveBeenCalled();
    };

    it("refuses a shell upgrade without it", () => {
      upgrade("/api?id=some-tab-id", { host: "127.0.0.1:1234" });

      expectRefused();
    });

    it("refuses a kube api upgrade with a wrong one", () => {
      upgrade("/api-kube/api/v1/namespaces/default/pods/some-pod/exec", {
        host: "127.0.0.1:1234",
        authorization: "Bearer some-wrong-token",
      });

      expectRefused();
    });

    it("refuses an upgrade for a foreign host, even with it", () => {
      upgrade("/api?id=some-tab-id", { ...validHeaders(), host: "attacker.example:1234" });

      expectRefused();
    });

    it("refuses an upgrade from a foreign origin, even with it", () => {
      upgrade("/api?id=some-tab-id", { ...validHeaders(), origin: "https://attacker.example" });

      expectRefused();
    });

    it("accepts it from the cookie of a frame, and strips it before going on", () => {
      const req = upgrade("/api?id=some-tab-id", {
        host: "some-cluster-id.renderer.ims-scope.app:1234",
        origin: "https://some-cluster-id.renderer.ims-scope.app:1234",
        cookie: `other=1; ims_scope_proxy_token=${di.inject(lensProxyTokenInjectable).value}`,
      });

      expect(shellApiRequest).toHaveBeenCalledTimes(1);
      expect(req.headers.cookie).toBeUndefined();
      expect(req.headers.authorization).toBeUndefined();
    });
  });
});

describe("lens proxy requests", () => {
  let di: DiContainer;
  let port: number;
  let routed: http.IncomingHttpHeaders[];
  let proxy: { listen: () => Promise<void>; close: () => Promise<void> | undefined };
  const publicPath = "/some-renderer-file.js";

  const get = async (path: string, headers: Record<string, string> = {}) => {
    const socket = net.connect(port, "127.0.0.1");

    await once(socket, "connect");

    const head = Object.entries({ host: "127.0.0.1", ...headers })
      .map(([name, value]) => `${name}: ${value}\r\n`)
      .join("");

    socket.write(`GET ${path} HTTP/1.1\r\n${head}Connection: close\r\n\r\n`);

    let response = "";

    for await (const chunk of socket) {
      response += (chunk as Buffer).toString();
    }

    return Number(response.split(" ")[1]);
  };

  const bearer = () => ({ authorization: `Bearer ${di.inject(lensProxyTokenInjectable).value}` });

  beforeEach(async () => {
    di = getDiForUnitTesting();
    routed = [];

    di.override(directoryForUserDataInjectable, () => "/some-directory-for-user-data");
    di.override(directoryForTempInjectable, () => "/some-directory-for-tmp");
    di.override(getClusterForRequestInjectable, () => () => undefined);
    di.override(shellApiRequestInjectable, () => vi.fn());
    di.override(kubeApiUpgradeRequestInjectable, () => vi.fn());
    di.override(
      routerInjectable,
      () =>
        ({
          isServedWithoutToken: (_method: string, url: string) => url === publicPath || url.startsWith("/api-kube"),
          route: async (_cluster: Cluster | undefined, req: ServerIncomingMessage, res: http.ServerResponse) => {
            routed.push({ ...req.headers });
            res.end();

            return true;
          },
        }) as unknown as Router,
    );

    proxy = di.inject(lensProxyInjectable);
    await proxy.listen();
    port = di.inject(lensProxyPortInjectable).get();
  });

  afterEach(async () => {
    await proxy.close();
  });

  it("serves a route marked as public without it", async () => {
    expect(await get(publicPath)).toBe(200);
  });

  it("refuses any other route without it, before the router", async () => {
    expect(await get("/api/some-route")).toBe(403);
    expect(routed).toHaveLength(0);
  });

  it("refuses a wrong one", async () => {
    expect(await get("/api/some-route", { authorization: "Bearer some-wrong-token" })).toBe(403);
  });

  it("serves with it as a bearer token, and strips it before routing", async () => {
    expect(await get("/api/some-route", bearer())).toBe(200);
    expect(routed[0].authorization).toBeUndefined();
  });

  it("serves with it as the cookie of a frame", async () => {
    const token = di.inject(lensProxyTokenInjectable).value;

    expect(
      await get("/api/some-route", {
        host: "renderer.ims-scope.app:1234",
        origin: "https://renderer.ims-scope.app:1234",
        cookie: `ims_scope_proxy_token=${token}`,
      }),
    ).toBe(200);
    expect(routed[0].cookie).toBeUndefined();
  });

  it("refuses a foreign host, even with it", async () => {
    expect(await get("/api/some-route", { ...bearer(), host: "attacker.example" })).toBe(403);
  });

  it("refuses a foreign origin, even with it", async () => {
    expect(await get("/api/some-route", { ...bearer(), origin: "https://attacker.example" })).toBe(403);
  });

  it("guards the kube api whatever the router says", async () => {
    expect(await get("/api-kube/api/v1/pods")).toBe(403);
  });
});
