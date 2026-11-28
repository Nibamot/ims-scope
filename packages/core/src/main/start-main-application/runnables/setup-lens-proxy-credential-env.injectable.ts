/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { beforeElectronIsReadyInjectionToken } from "@nibamot/application-for-electron-main";
import { getInjectable } from "@ogre-tools/injectable";
import withLensProxyCredentialEnvInjectable from "../../lens-proxy/with-lens-proxy-credential-env.injectable";

/**
 * Puts the lens-proxy token in the main process's environment before anything
 * is spawned, so every kubectl and helm started with the proxy kubeconfig
 * inherits what its `credential` plugin needs. Those are spawned from many
 * places, most of them inheriting `process.env` implicitly, and a missed one
 * would fail with 403.
 *
 * Every child of the main process can read the token this way, but each is a
 * process the user's own account started through IMS-Scope, and a terminal
 * hands it to whatever the user runs there anyway. What the token keeps out is
 * everything else on the machine.
 *
 * Terminals build their environment from the user's login shell instead, and
 * add it themselves.
 */
const setupLensProxyCredentialEnvInjectable = getInjectable({
  id: "setup-lens-proxy-credential-env",

  instantiate: (di) => ({
    run: () => {
      const withLensProxyCredentialEnv = di.inject(withLensProxyCredentialEnvInjectable);

      Object.assign(process.env, withLensProxyCredentialEnv(process.env));

      return undefined;
    },
  }),

  injectionToken: beforeElectronIsReadyInjectionToken,
});

export default setupLensProxyCredentialEnvInjectable;
