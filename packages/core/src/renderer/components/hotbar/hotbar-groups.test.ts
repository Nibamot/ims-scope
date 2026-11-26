/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { collectHotbarGroups, stepHotbarGroup } from "./hotbar-groups";

const entity = (name: string, group?: string) => ({
  getName: () => name,
  metadata: { labels: group === undefined ? {} : { group } },
});

const summarize = (groups: ReturnType<typeof collectHotbarGroups>) =>
  groups.map((group) => [group.key, group.label, group.entities.map((each) => each.getName())]);

describe("collectHotbarGroups", () => {
  it("groups tagged entities by label, sorted, and leaves untagged ones out", () => {
    const groups = collectHotbarGroups([
      entity("qa-2", "QA"),
      entity("untagged"),
      entity("dev-1", "Dev"),
      entity("blank", "  "),
      entity("qa-10", "QA"),
      entity("qa-1", "QA"),
    ]);

    expect(summarize(groups)).toEqual([
      ["dev", "Dev", ["dev-1"]],
      ["qa", "QA", ["qa-1", "qa-2", "qa-10"]],
    ]);
  });

  it("treats tags differing only in case or surrounding spaces as one group", () => {
    const groups = collectHotbarGroups([entity("a", " Cloud"), entity("b", "cloud ")]);

    expect(summarize(groups)).toEqual([["cloud", "Cloud", ["a", "b"]]]);
  });
});

describe("stepHotbarGroup", () => {
  const groups = collectHotbarGroups([entity("a", "Dev"), entity("b", "QA")]);

  it("cycles All, then each group, wrapping forwards", () => {
    expect(stepHotbarGroup(groups, undefined, 1)).toBe("dev");
    expect(stepHotbarGroup(groups, "dev", 1)).toBe("qa");
    expect(stepHotbarGroup(groups, "qa", 1)).toBeUndefined();
  });

  it("wraps backwards from All to the last group", () => {
    expect(stepHotbarGroup(groups, undefined, -1)).toBe("qa");
  });

  it("restarts from All when the active group no longer exists", () => {
    expect(stepHotbarGroup(groups, "gone", 1)).toBe("dev");
  });

  it("stays on All when nothing is tagged", () => {
    expect(stepHotbarGroup([], undefined, 1)).toBeUndefined();
  });
});
