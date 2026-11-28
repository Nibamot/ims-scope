/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { getInjectable } from "@ogre-tools/injectable";
import lensProxyCertificateInjectable from "../../common/certificate/lens-proxy-certificate.injectable";
import { lensProxyDispatcherInjectionToken } from "../../common/fetch/lens-proxy-dispatcher-injection-token";
import { hasAllowedHost } from "../lens-proxy/allowed-request";
import lensProxyTokenInjectable from "../lens-proxy/lens-proxy-token.injectable";
import { getLensProxyAgent, withBearerToken } from "./lens-proxy-agent";

import type { Dispatcher } from "undici";

/**
 * Whether `origin` is lens-proxy: https on one of the hosts it serves.
 */
export const isLensProxyOrigin = (origin: string): boolean => {
  try {
    const url = new URL(origin);

    return url.protocol === "https:" && hasAllowedHost({ host: url.host });
  } catch {
    return false;
  }
};

const lensProxyDispatcherInjectable = getInjectable({
  id: "lens-proxy-dispatcher",
  instantiate: (di) => {
    const lensProxyCertificate = di.inject(lensProxyCertificateInjectable);
    const token = di.inject(lensProxyTokenInjectable);
    // compose() allocates a dispatcher, and the certificate and token are fixed
    // for the run, so it is composed once.
    let dispatcher: Dispatcher | undefined;

    return () =>
      (dispatcher ??= getLensProxyAgent(lensProxyCertificate.get().cert).compose(
        withBearerToken(token.value, isLensProxyOrigin),
      ));
  },
  injectionToken: lensProxyDispatcherInjectionToken,
});

export default lensProxyDispatcherInjectable;
