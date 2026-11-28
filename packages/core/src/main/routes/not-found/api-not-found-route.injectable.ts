/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { apiPrefix } from "../../../common/vars";
import { route } from "../../router/route";
import { getRouteInjectable } from "../../router/router.injectable";

/**
 * A GET below the api that no route of its own answers would otherwise match
 * the renderer's catch-all file route, which is served without the token.
 */
const apiNotFoundRouteInjectable = getRouteInjectable({
  id: "api-not-found-route",
  instantiate: () =>
    route({
      method: "get",
      path: `${apiPrefix}/{path*}`,
    })(() => ({ statusCode: 404 })),
});

export default apiNotFoundRouteInjectable;
