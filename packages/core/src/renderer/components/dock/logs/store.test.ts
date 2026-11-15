/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { computed } from "mobx";
import { LogStore } from "./store";

import type { Pod } from "@nibamot/kube-object";

import type { LogTabData } from "./tab-store";

const tabId = "some-tab-id";
const pod = computed(() => ({ getNs: () => "some-namespace", getName: () => "some-pod" }) as Pod);
const tabData = computed(
  () =>
    ({
      selectedContainer: "some-container",
      showPrevious: false,
    }) as LogTabData,
);

/**
 * A callForLogs whose calls can each be resolved or rejected by the test, in
 * any order, to model responses arriving late.
 */
function makeControllableCallForLogs() {
  const calls: { resolve: (logs: string) => void; reject: (error: unknown) => void }[] = [];
  const callForLogs = vi.fn(
    () =>
      new Promise<string>((resolve, reject) => {
        calls.push({ resolve, reject });
      }),
  );

  return { calls, callForLogs };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("LogStore", () => {
  let store: LogStore;
  let calls: ReturnType<typeof makeControllableCallForLogs>["calls"];

  beforeEach(async () => {
    const controllable = makeControllableCallForLogs();

    calls = controllable.calls;
    store = new LogStore({ callForLogs: controllable.callForLogs });

    const loaded = store.load(tabId, pod, tabData);

    await flush();
    calls[0].resolve("2026-01-01T00:00:00Z first line");
    await loaded;
  });

  afterEach(() => {
    store.stopLoadingLogs(tabId);
  });

  it("keeps the logs already shown when a refresh fails", async () => {
    const refreshed = store.loadMore(tabId, pod, tabData);

    await flush();
    calls[1].reject(new DOMException("signal timed out", "TimeoutError"));
    await refreshed;

    expect(store.getLogs(tabId)).toEqual(["2026-01-01T00:00:00Z first line"]);
  });

  it("appends the next refresh after a failed one", async () => {
    const failed = store.loadMore(tabId, pod, tabData);

    await flush();
    calls[1].reject(new Error("some-error"));
    await failed;

    const refreshed = store.loadMore(tabId, pod, tabData);

    await flush();
    calls[2].resolve("2026-01-01T00:00:05Z second line");
    await refreshed;

    expect(store.getLogs(tabId)).toEqual(["2026-01-01T00:00:00Z first line", "2026-01-01T00:00:05Z second line"]);
  });

  it("does not start a refresh while one is still in flight", async () => {
    void store.loadMore(tabId, pod, tabData);
    void store.loadMore(tabId, pod, tabData);
    await flush();

    expect(calls).toHaveLength(2);
  });

  it("drops a refresh that answers after the logs were reloaded", async () => {
    const staleRefresh = store.loadMore(tabId, pod, tabData);

    await flush();

    const reloaded = store.reload(tabId, pod, tabData);

    await flush();
    calls[2].resolve("2026-01-01T00:01:00Z after reload");
    await reloaded;

    calls[1].resolve("2026-01-01T00:00:05Z stale");
    await staleRefresh;

    expect(store.getLogs(tabId)).toEqual(["2026-01-01T00:01:00Z after reload"]);
  });

  it("explains a timed out initial load in plain words", async () => {
    const reloaded = store.reload(tabId, pod, tabData);

    await flush();
    calls[1].reject(new DOMException("signal timed out", "TimeoutError"));
    await reloaded;

    expect(store.getLogs(tabId)).toEqual([
      "Failed to load logs: the request timed out.",
      "Switch to another tab and back to try again.",
    ]);
  });

  it("includes the reason of a kube api error", async () => {
    const reloaded = store.reload(tabId, pod, tabData);

    await flush();
    calls[1].reject({ message: "container not found", reason: "BadRequest", code: 400 });
    await reloaded;

    expect(store.getLogs(tabId)).toEqual(["Failed to load logs: container not found", "Reason: BadRequest (400)"]);
  });
});
