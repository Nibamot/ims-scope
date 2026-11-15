/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Copyright (c) OpenLens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import assert from "node:assert";
import path from "node:path";
import { getInjectable } from "@ogre-tools/injectable";
import httpProxy from "http-proxy-node16";
import { adaptUpstreamResponseForHttp2 } from "../../lens-proxy/http2-compat";

import type { LensApiRequest, RouteResponse } from "../../router/route";

// Must match the `server.port` of the Vite dev server started by
// `electron-vite dev` (ims-scope/electron.vite.config.ts); both sides read the
// same environment variable.
const devServerPort = Number(process.env.IMS_SCOPE_DEV_SERVER_PORT) || 9191;

assert(Number.isInteger(devServerPort), "IMS_SCOPE_DEV_SERVER_PORT environment variable must only be an integer");

const devStaticFileRouteHandlerInjectable = getInjectable({
  id: "dev-static-file-route-handler",
  instantiate: () => {
    const proxy = httpProxy.createProxy();
    const proxyTarget = `http://127.0.0.1:${devServerPort}`;

    // The lens proxy serves HTTP/2, which cannot carry the connection-specific
    // headers the Vite dev server answers with.
    proxy.on("proxyRes", (proxyRes, req) => adaptUpstreamResponseForHttp2(req, proxyRes));

    return async ({ raw: { req, res }, params }: LensApiRequest<"/{path*}">): Promise<RouteResponse<Buffer>> => {
      // Vite's own namespaces (/@vite/client, /@react-refresh, /@fs/, /@id/)
      // are extension-less module URLs and must reach the dev server
      // untouched. Any other extension-less path is an SPA route and maps to
      // the transformed index.html, which Vite serves at /index.html (the
      // webpack dev server served it at /build/index.html). Asset requests
      // keep their original URL so Vite's query markers (?v=, ?import, ?t=)
      // survive the proxy hop.
      const isSpaRoute =
        !params.path || params.path === "/" || (!params.path.startsWith("@") && !path.posix.extname(params.path));

      if (isSpaRoute) {
        req.url = "/index.html";
      }

      proxy.web(req, res, { target: proxyTarget });

      return { proxy };
    };
  },
});

export default devStaticFileRouteHandlerInjectable;
