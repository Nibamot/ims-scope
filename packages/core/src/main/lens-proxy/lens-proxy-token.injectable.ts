/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { getInjectable } from "@ogre-tools/injectable";
import randomBytesInjectable from "../../common/utils/random-bytes.injectable";
import { tokenMatches } from "./lens-proxy-token";

export interface LensProxyToken {
  /**
   * The token every client of lens-proxy has to present: 32 random bytes as
   * hex, generated once per run and kept in memory only.
   */
  readonly value: string;
  /**
   * Whether `candidate` is the token, compared in constant time.
   */
  matches(candidate: string | undefined): boolean;
}

/**
 * The token lens-proxy requires on every request except the renderer's own
 * files. Without it, any process on the machine could reach the user's clusters
 * through the proxy with the user's credentials.
 *
 * Each client carries it the way it can: the frames as a cookie, the main
 * process as a header, and kubectl, helm and terminals through the environment
 * of the proxy kubeconfig's `credential` plugin.
 */
const lensProxyTokenInjectable = getInjectable({
  id: "lens-proxy-token",
  instantiate: (di): LensProxyToken => {
    const randomBytes = di.inject(randomBytesInjectable);
    const value = randomBytes(32).toString("hex");

    return {
      value,
      matches: (candidate) => tokenMatches(value, candidate),
    };
  },
});

export default lensProxyTokenInjectable;
