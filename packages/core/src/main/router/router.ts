/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Copyright (c) OpenLens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import Call from "@hapi/call";
import type http from "node:http";

import type { Cluster } from "../../common/cluster/cluster";
import type { ServerIncomingMessage } from "../lens-proxy/lens-proxy";
import type { CreateHandlerForRoute, RouteHandler } from "./create-handler-for-route.injectable";
import type { ParseRequest } from "./parse-request.injectable";
import type { LensApiRequest, Route } from "./route";

export interface RouterRequestOpts {
  req: http.IncomingMessage;
  res: http.ServerResponse;
  cluster: Cluster | undefined;
  params: Partial<Record<string, string>>;
  url: URL;
}

interface Dependencies {
  parseRequest: ParseRequest;
  createHandlerForRoute: CreateHandlerForRoute;
  readonly routes: Route<unknown, string>[];
}

interface RouteEntry {
  handler: RouteHandler;
  withoutToken: boolean;
}

export class Router {
  private readonly router = new Call.Router<RouteEntry>();

  constructor(private readonly dependencies: Dependencies) {
    for (const route of this.dependencies.routes) {
      this.router.add(
        { method: route.method, path: route.path },
        { handler: this.dependencies.createHandlerForRoute(route), withoutToken: route.withoutToken === true },
      );
    }
  }

  /**
   * Whether the route `route` would run for this request is served without
   * the lens-proxy token. It matches on the same normalized path as `route`, so
   * no spelling of a guarded path, such as `/./api/…`, reaches its route
   * unguarded. A request that matches no route, or whose target does not
   * parse, needs the token.
   */
  public isServedWithoutToken(method: string, reqUrl: string): boolean {
    try {
      return this.match(method, reqUrl)?.route.withoutToken === true;
    } catch {
      return false;
    }
  }

  public async route(
    cluster: Cluster | undefined,
    req: ServerIncomingMessage,
    res: http.ServerResponse,
  ): Promise<boolean> {
    const match = this.match(req.method, req.url);

    if (!match) {
      return false;
    }

    const request = await this.getRequest({ req, res, cluster, url: match.url, params: match.params });

    await match.route.handler(request, res);

    return true;
  }

  private match(method: string, reqUrl: string) {
    const url = new URL(reqUrl, "http://localhost");
    const matchingRoute = this.router.route(method.toLowerCase(), url.pathname);

    if (matchingRoute instanceof Error) {
      return undefined;
    }

    return { url, route: matchingRoute.route, params: matchingRoute.params };
  }

  protected async getRequest(opts: RouterRequestOpts): Promise<LensApiRequest<string>> {
    const { req, res, url, cluster, params } = opts;
    const { payload } = await this.dependencies.parseRequest(req, null, {
      parse: true,
      output: "data",
    });

    return {
      cluster,
      path: url.pathname,
      raw: {
        req,
        res,
      },
      query: url.searchParams,
      payload,
      params,
    };
  }
}
