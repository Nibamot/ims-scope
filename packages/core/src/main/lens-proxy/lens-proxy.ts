/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Copyright (c) OpenLens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import assert from "node:assert";
import http2 from "node:http2";
import net from "node:net";
import { apiKubePrefix, apiPrefix } from "../../common/vars";
import { getBoolean } from "../utils/parse-query";
import { hasAllowedHost, hasAllowedOrigin } from "./allowed-request";
import { adaptUpstreamResponseForHttp2, normalizeHttp2Request } from "./http2-compat";
import { stripToken, tokenFromHeaders } from "./lens-proxy-token";
import type http from "node:http";

import type { Logger } from "@nibamot/logger";

import type httpProxy from "http-proxy-node16";
import type { SetRequired } from "type-fest";

import type { EmitAppEvent } from "../../common/app-event-bus/emit-event.injectable";
import type { SelfSignedCert } from "../../common/certificate/certificate";
import type { Cluster } from "../../common/cluster/cluster";
import type { KubeAuthProxyServer } from "../cluster/kube-auth-proxy-server.injectable";
import type { Router } from "../router/router";
import type { LensProxyToken } from "./lens-proxy-token.injectable";
import type { ProxyApiRequestArgs, ShellApiRequestArgs } from "./proxy-functions";

export type GetClusterForRequest = (req: http.IncomingMessage) => Cluster | undefined;
export type ServerIncomingMessage = SetRequired<http.IncomingMessage, "url" | "method">;
export type LensProxyApiRequest = (args: ProxyApiRequestArgs) => void | Promise<void>;
export type LensProxyShellApiRequest = (args: ShellApiRequestArgs) => void | Promise<void>;

interface Dependencies {
  getClusterForRequest: GetClusterForRequest;
  shellApiRequest: LensProxyShellApiRequest;
  kubeApiUpgradeRequest: LensProxyApiRequest;
  emitAppEvent: EmitAppEvent;
  getKubeAuthProxyServer: (cluster: Cluster) => KubeAuthProxyServer;
  readonly router: Router;
  readonly proxy: httpProxy;
  readonly lensProxyPort: { set: (portNumber: number) => void };
  readonly contentSecurityPolicy: string;
  readonly logger: Logger;
  readonly certificate: SelfSignedCert;
  readonly token: LensProxyToken;
}

const watchParam = "watch";
const followParam = "follow";

export function isLongRunningRequest(reqUrl: string) {
  const url = new URL(reqUrl, "http://localhost");

  return getBoolean(url.searchParams, watchParam) || getBoolean(url.searchParams, followParam);
}

/**
 * This is the list of ports that chrome considers unsafe to allow HTTP
 * connections to. Because they are the standard ports for processes that are
 * too forgiving in the connection types they accept.
 *
 * If we get one of these ports, the easiest thing to do is to just try again.
 *
 * Source: https://chromium.googlesource.com/chromium/src.git/+/refs/heads/main/net/base/port_util.cc
 */
const disallowedPorts = new Set([
  1, 7, 9, 11, 13, 15, 17, 19, 20, 21, 22, 23, 25, 37, 42, 43, 53, 69, 77, 79, 87, 95, 101, 102, 103, 104, 109, 110,
  111, 113, 115, 117, 119, 123, 135, 137, 139, 143, 161, 179, 389, 427, 465, 512, 513, 514, 515, 526, 530, 531, 532,
  540, 548, 554, 556, 563, 587, 601, 636, 989, 990, 993, 995, 1719, 1720, 1723, 2049, 3659, 4045, 5060, 5061, 6000,
  6566, 6665, 6666, 6667, 6668, 6669, 6697, 10080,
]);

/**
 * How long a connection that is still serving a request is given to finish
 * before it is destroyed, once the proxy has stopped accepting new ones.
 */
const closeGracePeriodMs = 500;

export class LensProxy {
  protected readonly proxyServer: http2.Http2SecureServer;
  protected closed = false;
  protected readonly retryCounters = new Map<string, number>();
  /**
   * Every open client connection, so that `close` can destroy the ones still
   * busy once the grace period is up. `Http2SecureServer` has no
   * `closeAllConnections` of its own.
   */
  protected readonly connections = new Set<net.Socket>();
  /**
   * Requests that passed the token check. The token is stripped once checked,
   * so a request the proxy error handler hands back to `handleRequest` for a
   * retry would otherwise fail it.
   */
  protected readonly authorizedRequests = new WeakSet<http.IncomingMessage>();

  constructor(private readonly dependencies: Dependencies) {
    this.configureProxy(dependencies.proxy);

    /**
     * HTTP/2, so that Chromium multiplexes a cluster frame's requests over one
     * connection instead of capping them at six per host, which long-lived
     * watches would otherwise exhaust (see `./http2-compat`). `allowHTTP1`
     * keeps HTTP/1.1 working for clients that do not negotiate h2, and for
     * WebSocket upgrades, which Chromium still opens over HTTP/1.1.
     */
    this.proxyServer = http2.createSecureServer(
      {
        key: dependencies.certificate.private,
        cert: dependencies.certificate.cert,
        allowHTTP1: true,
      },
      (req, res) => {
        normalizeHttp2Request(req);
        // The HTTP/2 compatibility API mirrors the HTTP/1 request/response
        // surface the router and http-proxy use.
        this.handleRequest(req as unknown as ServerIncomingMessage, res as unknown as http.ServerResponse);
      },
    );

    this.proxyServer.on("connection", (socket: net.Socket) => {
      this.connections.add(socket);
      socket.once("close", () => this.connections.delete(socket));
    });

    this.proxyServer.on("upgrade", (req: ServerIncomingMessage, socket: net.Socket, head: Buffer) => {
      // A shell and the kube api are both reached through an upgrade, so it is
      // refused before anything of it is read when it does not come from one of
      // our clients.
      const refusal = this.refusalOf(req);

      if (refusal) {
        this.dependencies.logger.warn(`[LENS-PROXY]: refused an upgrade: ${refusal}`, { url: req.url });
        socket.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");

        return;
      }

      stripToken(req.headers);

      /**
       * Decided before the cluster is looked up: an internal upgrade is a
       * shell request, and a shell can be opened outside of any cluster
       * session. Everything else is a kube-api upgrade and still requires one.
       */
      const isInternal = req.url.startsWith(`${apiPrefix}?`);
      const cluster = this.dependencies.getClusterForRequest(req);

      (async () => {
        if (isInternal) {
          return this.dependencies.shellApiRequest({ req, socket, head, cluster });
        }

        if (!cluster) {
          this.dependencies.logger.error(
            `[LENS-PROXY]: Could not find cluster for upgrade request from url=${req.url}`,
          );
          socket.destroy();

          return;
        }

        return this.dependencies.kubeApiUpgradeRequest({ req, socket, head, cluster });
      })().catch((error) => this.dependencies.logger.error("[LENS-PROXY]: failed to handle proxy upgrade", error));
    });
  }

  /**
   * Starts to listen on an OS provided port. Will reject if the server throws
   * an error.
   *
   * Resolves with the port number that was picked
   */
  private attemptToListen(): Promise<number> {
    return new Promise<number>((resolve, reject) => {
      this.proxyServer.listen(0, "127.0.0.1");

      this.proxyServer
        .once("listening", () => {
          this.proxyServer.removeAllListeners("error"); // don't reject the promise

          const { address, port } = this.proxyServer.address() as net.AddressInfo;

          this.dependencies.lensProxyPort.set(port);

          this.dependencies.logger.info(`[LENS-PROXY]: Proxy server has started at ${address}:${port}`);

          this.proxyServer.on("error", (error) => {
            this.dependencies.logger.info(`[LENS-PROXY]: Subsequent error: ${error}`);
          });

          this.dependencies.emitAppEvent({ name: "lens-proxy", action: "listen", params: { port } });
          resolve(port);
        })
        .once("error", (error) => {
          this.dependencies.logger.info(`[LENS-PROXY]: Proxy server failed to start: ${error}`);
          reject(error);
        });
    });
  }

  /**
   * Starts the lens proxy.
   * @resolves After the server is listening on a good port
   * @rejects if there is an error before that happens
   */
  async listen(): Promise<void> {
    const seenPorts = new Set<number>();

    while (true) {
      this.proxyServer?.close();
      const port = await this.attemptToListen();

      if (!disallowedPorts.has(port)) {
        // We didn't get a port that would result in an ERR_UNSAFE_PORT error, use it
        return;
      }

      this.dependencies.logger.warn(
        `[LENS-PROXY]: Proxy server has with port known to be considered unsafe to connect to by chrome, restarting...`,
      );

      if (seenPorts.has(port)) {
        /**
         * Assume that if we have seen the port before, then the OS has looped
         * through all the ports possible and we will not be able to get a safe
         * port.
         */
        throw new Error(
          "Failed to start IMS-Scope Proxy due to seeing too many unsafe ports. Please restart IMS-Scope.",
        );
      } else {
        seenPorts.add(port);
      }
    }
  }

  close() {
    if (this.closed) {
      return;
    }

    // mark as closed immediately
    this.closed = true;
    this.dependencies.logger.info("[LENS-PROXY]: Closing server");

    return new Promise<void>((resolve) => {
      /**
       * The proxy carries connections that are never idle -- watch and follow
       * requests, and the sockets of upgraded shell sessions -- so waiting for
       * them to end on their own would hang the quit sequence. Give them the
       * grace period and then destroy whatever is left, which lets `close`
       * finally call back.
       */
      const destroyRemaining = setTimeout(() => {
        for (const socket of this.connections) {
          socket.destroy();
        }
      }, closeGracePeriodMs);

      // `close` itself ends connections that are already idle: HTTP/2
      // sessions with no open stream, and keep-alive HTTP/1.1 connections.
      this.proxyServer.close(() => {
        clearTimeout(destroyRemaining);
        resolve();
      });
    });
  }

  protected configureProxy(proxy: httpProxy): httpProxy {
    proxy.on("proxyRes", (proxyRes, req, res) => {
      adaptUpstreamResponseForHttp2(req, proxyRes);

      const retryCounterId = this.getRequestId(req);

      if (this.retryCounters.has(retryCounterId)) {
        this.retryCounters.delete(retryCounterId);
      }

      proxyRes.on("aborted", () => {
        // happens when proxy target aborts connection
        res.end();
      });
    });

    proxy.on("error", (error, req, res, target) => {
      if (this.closed || res instanceof net.Socket) {
        return;
      }

      this.dependencies.logger.error(`[LENS-PROXY]: http proxy errored for cluster: ${error}`, { url: req.url });

      if (target) {
        this.dependencies.logger.debug(`Failed proxy to target: ${JSON.stringify(target, null, 2)}`);

        if (req.method === "GET" && (!res.statusCode || res.statusCode >= 500)) {
          const reqId = this.getRequestId(req);
          const retryCount = this.retryCounters.get(reqId) || 0;
          const timeoutMs = retryCount * 250;

          if (retryCount < 20) {
            this.dependencies.logger.debug(`Retrying proxy request to url: ${reqId}`);
            setTimeout(() => {
              this.retryCounters.set(reqId, retryCount + 1);
              this.handleRequest(req as ServerIncomingMessage, res).catch((error) =>
                this.dependencies.logger.error(`[LENS-PROXY]: failed to handle request on proxy error: ${error}`),
              );
            }, timeoutMs);
          }
        }
      }

      try {
        res.writeHead(500).end(`Oops, something went wrong.\n${error}`);
      } catch (e) {
        this.dependencies.logger.error(`[LENS-PROXY]: Failed to write headers: `, e);
      }
    });

    return proxy;
  }

  protected getRequestId(req: http.IncomingMessage): string {
    assert(req.headers.host);

    return req.headers.host + req.url;
  }

  /**
   * Why a request is refused, or `undefined` when it may go on: it must be for
   * a host we serve, come from no page or one of our frames, and carry the
   * token.
   */
  protected refusalOf(req: ServerIncomingMessage): string | undefined {
    if (!hasAllowedHost(req.headers)) {
      return "foreign host";
    }

    if (!hasAllowedOrigin(req.headers)) {
      return "foreign origin";
    }

    if (!this.dependencies.token.matches(tokenFromHeaders(req.headers))) {
      return "missing or invalid token";
    }

    return undefined;
  }

  protected async handleRequest(req: ServerIncomingMessage, res: http.ServerResponse) {
    // Looked up first because it rewrites the `/<clusterId>/…` path of kubectl
    // and helm to the kube api prefix, which is then guarded like any other.
    const cluster = this.dependencies.getClusterForRequest(req);

    // Every request needs the token except one the router serves without it:
    // the renderer's files and `/version`, which the window loads before the
    // frames can carry it. The kube api never reaches the router.
    if (
      !this.authorizedRequests.has(req) &&
      (req.url.startsWith(apiKubePrefix) || !this.dependencies.router.isServedWithoutToken(req.method, req.url))
    ) {
      const refusal = this.refusalOf(req);

      if (refusal) {
        this.dependencies.logger.warn(`[LENS-PROXY]: refused a request: ${refusal}`, { url: req.url });
        res.writeHead(403, { "Content-Type": "text/plain" }).end("Forbidden");

        return;
      }

      stripToken(req.headers);
      this.authorizedRequests.add(req);
    }

    if (cluster && req.url.startsWith(apiKubePrefix)) {
      // The frame's `Origin` was checked above and means nothing to the
      // cluster; a gateway in front of one may refuse an origin it does not
      // know.
      delete req.headers.origin;
      req.url = req.url.replace(apiKubePrefix, "");

      const kubeAuthProxyServer = this.dependencies.getKubeAuthProxyServer(cluster);
      const proxyTarget = await kubeAuthProxyServer.getApiTarget(isLongRunningRequest(req.url));

      if (proxyTarget) {
        return this.dependencies.proxy.web(req, res, proxyTarget);
      }
    }

    res.setHeader("Content-Security-Policy", this.dependencies.contentSecurityPolicy);
    if (!(await this.dependencies.router.route(cluster, req, res))) {
      res.writeHead(404, { "Content-Type": "text/plain" }).end("Not Found");
    }
  }
}
