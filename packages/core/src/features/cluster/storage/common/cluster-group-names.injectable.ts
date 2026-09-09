/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { getInjectable } from "@ogre-tools/injectable";
import { computed } from "mobx";
import clustersInjectable from "./clusters.injectable";

const clusterGroupNamesInjectable = getInjectable({
  id: "cluster-group-names",
  instantiate: (di) => {
    const clusters = di.inject(clustersInjectable);

    return computed(() => {
      const names = new Set(
        clusters
          .get()
          .map((cluster) => cluster.preferences.group?.trim())
          .filter((group): group is string => !!group),
      );

      return [...names].sort((a, b) => a.localeCompare(b));
    });
  },
});

export default clusterGroupNamesInjectable;
