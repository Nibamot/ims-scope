/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { getInjectable } from "@ogre-tools/injectable";
import lensProxyPortInjectable from "../../../lens-proxy/lens-proxy-port.injectable";
import { lensProxyTokenCookie } from "../../../lens-proxy/lens-proxy-token";
import lensProxyTokenInjectable from "../../../lens-proxy/lens-proxy-token.injectable";

import type { Session } from "electron";

export type SetLensProxyTokenCookie = (session: Session) => Promise<void>;

/**
 * Sets the lens-proxy token as a cookie on a window's session before it loads,
 * so the root and cluster frames carry it on every request to lens-proxy: their
 * own fetches, module loads and WebSockets, none of which renderer code can add
 * a header to.
 *
 * It is for `.renderer.ims-scope.app`, the domain of every frame, whatever the
 * port. `HttpOnly` keeps it from renderer code, `SameSite=Strict` from any page
 * of another site, and with no expiry it is a session cookie that is never
 * written to disk.
 */
const setLensProxyTokenCookieInjectable = getInjectable({
  id: "set-lens-proxy-token-cookie",
  instantiate: (di): SetLensProxyTokenCookie => {
    const token = di.inject(lensProxyTokenInjectable);
    const lensProxyPort = di.inject(lensProxyPortInjectable);

    return (session) =>
      session.cookies.set({
        url: `https://renderer.ims-scope.app:${lensProxyPort.get()}`,
        domain: ".renderer.ims-scope.app",
        name: lensProxyTokenCookie,
        value: token.value,
        secure: true,
        httpOnly: true,
        sameSite: "strict",
      });
  },
});

export default setLensProxyTokenCookieInjectable;
