/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import path from "node:path";
import { getInjectable } from "@ogre-tools/injectable";
import baseBundledBinariesDirectoryInjectable from "../../common/vars/base-bundled-binaries-dir.injectable";
import isWindowsInjectable from "../../common/vars/is-windows.injectable";
import { lensProxyTokenEnvVar } from "./lens-proxy-token";
import lensProxyTokenInjectable from "./lens-proxy-token.injectable";

export type WithLensProxyCredentialEnv = <T extends Partial<Record<string, string>>>(env: T) => T;

/**
 * Adds what the `credential` plugin of the proxy kubeconfig needs to an
 * environment: the lens-proxy token it reads, and on Windows the bundled
 * binaries directory at the end of `PATH`, where the bare command name the
 * kubeconfig gives there is found. Appended, so it shadows nothing the user has.
 */
const withLensProxyCredentialEnvInjectable = getInjectable({
  id: "with-lens-proxy-credential-env",
  instantiate: (di): WithLensProxyCredentialEnv => {
    const token = di.inject(lensProxyTokenInjectable);
    const isWindows = di.inject(isWindowsInjectable);
    const baseBundledBinariesDirectory = di.inject(baseBundledBinariesDirectoryInjectable);

    return (env) => {
      const result = { ...env, [lensProxyTokenEnvVar]: token.value };

      if (isWindows) {
        // Windows environment names are case-insensitive, and node keeps the
        // spelling it found (usually `Path`).
        const pathKey = Object.keys(result).find((key) => key.toUpperCase() === "PATH") ?? "PATH";
        const entries = (result[pathKey] ?? "").split(path.win32.delimiter).filter(Boolean);

        if (!entries.includes(baseBundledBinariesDirectory)) {
          (result as Partial<Record<string, string>>)[pathKey] = [...entries, baseBundledBinariesDirectory].join(
            path.win32.delimiter,
          );
        }
      }

      return result;
    };
  },
});

export default withLensProxyCredentialEnvInjectable;
