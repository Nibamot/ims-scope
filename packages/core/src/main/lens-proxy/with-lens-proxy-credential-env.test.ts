/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import directoryForUserDataInjectable from "../../common/app-paths/directory-for-user-data/directory-for-user-data.injectable";
import baseBundledBinariesDirectoryInjectable from "../../common/vars/base-bundled-binaries-dir.injectable";
import isWindowsInjectable from "../../common/vars/is-windows.injectable";
import { getDiForUnitTesting } from "../getDiForUnitTesting";
import lensProxyTokenInjectable from "./lens-proxy-token.injectable";
import withLensProxyCredentialEnvInjectable from "./with-lens-proxy-credential-env.injectable";

import type { DiContainer } from "@ogre-tools/injectable";

describe("withLensProxyCredentialEnv", () => {
  let di: DiContainer;

  beforeEach(() => {
    di = getDiForUnitTesting();
    di.override(directoryForUserDataInjectable, () => "/some-directory-for-user-data");
    di.override(baseBundledBinariesDirectoryInjectable, () => "C:\\some-bundled");
  });

  it("adds the token without changing the given environment", () => {
    di.override(isWindowsInjectable, () => false);

    const env = { PATH: "/usr/bin" };
    const result = di.inject(withLensProxyCredentialEnvInjectable)(env);

    expect(result).toEqual({ PATH: "/usr/bin", FREELENS_PROXY_TOKEN: di.inject(lensProxyTokenInjectable).value });
    expect(env).toEqual({ PATH: "/usr/bin" });
  });

  it("appends the bundled binaries directory to Path on Windows, once", () => {
    di.override(isWindowsInjectable, () => true);

    const withEnv = di.inject(withLensProxyCredentialEnvInjectable);
    const result = withEnv(withEnv({ Path: "C:\\Windows" }));

    expect(result.Path).toBe("C:\\Windows;C:\\some-bundled");
  });
});
