/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { getInjectable } from "@ogre-tools/injectable";
import { action, computed, observable } from "mobx";
import catalogEntityRegistryInjectable from "../../api/catalog/entity/registry.injectable";
import { collectHotbarGroups, stepHotbarGroup } from "./hotbar-groups";

import type { IComputedValue } from "mobx";

import type { CatalogEntity } from "../../api/catalog-entity";
import type { HotbarGroup } from "./hotbar-groups";

export interface HotbarGroupCycle {
  /** Every group tagged on a catalog entity, sorted by label. */
  readonly groups: IComputedValue<HotbarGroup<CatalogEntity>[]>;
  /** The group being shown, or `undefined` for "All" (the regular hotbar). */
  readonly active: IComputedValue<HotbarGroup<CatalogEntity> | undefined>;
  select(key: string | undefined): void;
  next(): void;
  previous(): void;
}

const hotbarGroupCycleInjectable = getInjectable({
  id: "hotbar-group-cycle",
  instantiate: (di): HotbarGroupCycle => {
    const entityRegistry = di.inject(catalogEntityRegistryInjectable);
    const activeKey = observable.box<string | undefined>(undefined);
    const groups = computed(() => collectHotbarGroups(entityRegistry.filteredItems));
    // A group whose last cluster lost its tag simply stops matching, which
    // falls back to "All" without having to reset the selection.
    const active = computed(() => groups.get().find((group) => group.key === activeKey.get()));
    const step = (direction: 1 | -1) => activeKey.set(stepHotbarGroup(groups.get(), active.get()?.key, direction));

    return {
      groups,
      active,
      select: action((key: string | undefined) => activeKey.set(key)),
      next: action(() => step(1)),
      previous: action(() => step(-1)),
    };
  },
});

export default hotbarGroupCycleInjectable;
