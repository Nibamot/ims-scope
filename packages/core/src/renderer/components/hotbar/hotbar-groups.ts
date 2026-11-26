/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { normalizeGroup } from "./hotbar-group-dividers";

export interface HotbarGroupableEntity {
  getName(): string;
  metadata: { labels?: Partial<Record<string, string>> };
}

export interface HotbarGroup<Entity extends HotbarGroupableEntity = HotbarGroupableEntity> {
  /** The normalized tag (trimmed, lower-cased): "QA" and "qa " are one group. */
  key: string;
  /** The tag as first spelled by an entity, for display. */
  label: string;
  /** The tagged entities, sorted by name. */
  entities: Entity[];
}

const byName = (left: HotbarGroupableEntity, right: HotbarGroupableEntity) =>
  left.getName().localeCompare(right.getName(), undefined, { sensitivity: "base", numeric: true });

/**
 * Builds one group per distinct `group` label among the entities, sorted by
 * label, each holding its tagged entities sorted by name. Untagged entities are
 * left out: they only appear on the regular hotbar.
 */
export function collectHotbarGroups<Entity extends HotbarGroupableEntity>(
  entities: readonly Entity[],
): HotbarGroup<Entity>[] {
  const groups = new Map<string, HotbarGroup<Entity>>();

  for (const entity of entities) {
    const label = entity.metadata.labels?.group;
    const key = normalizeGroup(label);

    if (!key || !label) {
      continue;
    }

    const group = groups.get(key);

    if (group) {
      group.entities.push(entity);
    } else {
      groups.set(key, { key, label: label.trim(), entities: [entity] });
    }
  }

  return [...groups.values()]
    .map((group) => ({ ...group, entities: group.entities.sort(byName) }))
    .sort((left, right) => left.label.localeCompare(right.label, undefined, { sensitivity: "base", numeric: true }));
}

/**
 * Steps through the cycle "All" (`undefined`), then each group in order,
 * wrapping at both ends. An unknown `activeKey` counts as "All".
 */
export function stepHotbarGroup(
  groups: readonly HotbarGroup[],
  activeKey: string | undefined,
  step: 1 | -1,
): string | undefined {
  const cycle = [undefined, ...groups.map((group) => group.key)];
  const current = Math.max(cycle.indexOf(activeKey), 0);

  return cycle[(current + step + cycle.length) % cycle.length];
}
