/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Copyright (c) OpenLens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { getOrInsertWith, interval, waitUntilDefined } from "@nibamot/utilities";
import { observable } from "mobx";

import type { Pod, PodLogsQuery } from "@nibamot/kube-object";
import type { IntervalFn } from "@nibamot/utilities";

import type { IComputedValue } from "mobx";

import type { TabId } from "../dock/store";
import type { CallForLogs } from "./call-for-logs.injectable";
import type { LogTabData } from "./tab-store";

type PodLogLine = string;

const logLinesToLoad = 500;

// If the pod/tab data never becomes available (e.g. dropped from the watch stream), bound the
// wait so load()/loadMore() reject and clear isLoading instead of hanging forever.
const podDataWaitTimeoutMs = 30_000;

interface Dependencies {
  callForLogs: CallForLogs;
}

export class LogStore {
  protected podLogs = observable.map<TabId, PodLogLine[]>();
  protected refreshers = new Map<TabId, IntervalFn>();
  /**
   * Bumped whenever a tab's logs are cleared, so a request started before
   * that (a refresh still in flight when the user reloads or switches
   * container) can tell its response is stale and drop it.
   */
  protected generations = new Map<TabId, number>();
  /**
   * Tabs with a refresh in flight. The refresher fires every few seconds while
   * a request may take up to its timeout, so without this they would pile up.
   */
  protected refreshesInFlight = new Set<TabId>();

  constructor(private dependencies: Dependencies) {}

  protected getGeneration(tabId: TabId): number {
    return this.generations.get(tabId) ?? 0;
  }

  protected describeError(error: any): string[] {
    if (error?.error && !(error.message || error.reason || error.code)) {
      error = error.error;
    }

    // Raised by the request's AbortSignal.timeout(), a DOMException whose
    // numeric `code` (23) and missing `reason` mean nothing to the user.
    if (error?.name === "TimeoutError") {
      return ["Failed to load logs: the request timed out.", "Switch to another tab and back to try again."];
    }

    const message = [`Failed to load logs: ${error?.message ?? String(error)}`];

    if (error?.reason) {
      message.push(`Reason: ${error.reason}${error.code ? ` (${error.code})` : ""}`);
    }

    return message;
  }

  protected handlerError(tabId: TabId, error: any): void {
    this.stopLoadingLogs(tabId);
    this.podLogs.set(tabId, this.describeError(error));
  }

  /**
   * Function prepares tailLines param for passing to API request
   * Each time it increasing it's number, caused to fetch more logs.
   * Also, it handles loading errors, rewriting whole logs with error
   * messages
   */
  public async load(
    tabId: TabId,
    computedPod: IComputedValue<Pod | undefined>,
    logTabData: IComputedValue<LogTabData | undefined>,
  ): Promise<void> {
    const generation = this.getGeneration(tabId);

    try {
      const logs = await this.loadLogs(computedPod, logTabData, {
        tailLines: this.getLogLines(tabId) + logLinesToLoad,
      });

      if (generation !== this.getGeneration(tabId)) {
        return;
      }

      this.getRefresher(tabId, computedPod, logTabData).start();
      this.podLogs.set(tabId, logs);
    } catch (error) {
      if (generation !== this.getGeneration(tabId)) {
        return;
      }

      this.handlerError(tabId, error);
    }
  }

  private getRefresher(
    tabId: TabId,
    computedPod: IComputedValue<Pod | undefined>,
    logTabData: IComputedValue<LogTabData | undefined>,
  ): IntervalFn {
    return getOrInsertWith(this.refreshers, tabId, () =>
      interval(10, () => {
        if (this.podLogs.has(tabId)) {
          this.loadMore(tabId, computedPod, logTabData);
        }
      }),
    );
  }

  /**
   * Stop loading more logs for a given tab
   * @param tabId The ID of the logs tab to stop loading more logs for
   */
  public stopLoadingLogs(tabId: TabId): void {
    this.refreshers.get(tabId)?.stop();
  }

  /**
   * Function is used to refresher/stream-like requests.
   * It changes 'sinceTime' param each time allowing to fetch logs
   * starting from last line received.
   * @param tabId
   */
  public async loadMore(
    tabId: TabId,
    computedPod: IComputedValue<Pod | undefined>,
    logTabData: IComputedValue<LogTabData | undefined>,
  ): Promise<void> {
    const oldLogs = this.podLogs.get(tabId);

    if (!oldLogs?.length || this.refreshesInFlight.has(tabId)) {
      return;
    }

    const generation = this.getGeneration(tabId);

    this.refreshesInFlight.add(tabId);

    try {
      const logs = await this.loadLogs(computedPod, logTabData, {
        sinceTime: this.getLastSinceTime(tabId),
      });

      if (generation !== this.getGeneration(tabId)) {
        return;
      }

      // Add newly received logs to bottom. Read the current lines rather than
      // `oldLogs`: they may have grown (loading older lines) meanwhile.
      this.podLogs.set(tabId, [...this.getLogs(tabId), ...logs.filter(Boolean)]);
    } catch (error) {
      // A failed refresh keeps the logs already shown and leaves the refresher
      // running, so the next tick retries; replacing them with an error and
      // stopping would leave the tab dead until a manual reload.
      console.warn(`[LOG-STORE]: failed to refresh logs for tab ${tabId}, will retry`, error);
    } finally {
      this.refreshesInFlight.delete(tabId);
    }
  }

  /**
   * Main logs loading function adds necessary data to payload and makes
   * an API request
   * @param tabId
   * @param params request parameters described in IPodLogsQuery interface
   * @returns A fetch request promise
   */
  private async loadLogs(
    computedPod: IComputedValue<Pod | undefined>,
    logTabData: IComputedValue<LogTabData | undefined>,
    params: Partial<PodLogsQuery>,
  ): Promise<string[]> {
    const {
      pod,
      tabData: { selectedContainer, showPrevious },
    } = await waitUntilDefined(
      () => {
        const pod = computedPod.get();
        const tabData = logTabData.get();

        if (pod && tabData) {
          return { pod, tabData };
        }

        return undefined;
      },
      { timeout: podDataWaitTimeoutMs },
    );
    const namespace = pod.getNs();
    const name = pod.getName();

    const result = await this.dependencies.callForLogs(
      { namespace, name },
      {
        ...params,
        timestamps: true, // Always setting timestamp to separate old logs from new ones
        container: selectedContainer,
        previous: showPrevious,
      },
    );

    return result.trimEnd().replace(/\r/g, "\n").split("\n");
  }

  /**
   * @deprecated This depends on dockStore, which should be removed
   * Converts logs into a string array
   * @returns Length of log lines
   */
  get lines(): number {
    return this.logs.length;
  }

  getLogLines(tabId: TabId): number {
    return this.getLogs(tabId).length;
  }

  areLogsPresent(tabId: TabId): boolean {
    return !this.podLogs.has(tabId);
  }

  getLogs(tabId: TabId): string[] {
    return this.podLogs.get(tabId) ?? [];
  }

  getLogsWithoutTimestamps(tabId: TabId): string[] {
    return this.getLogs(tabId).map(this.removeTimestamps);
  }

  getTimestampSplitLogs(tabId: TabId): [string, string][] {
    return this.getLogs(tabId).map(this.splitOutTimestamp);
  }

  /**
   * @deprecated This now only returns the empty array
   * Returns logs with timestamps for selected tab
   */
  get logs(): string[] {
    return [];
  }

  /**
   * @deprecated This now only returns the empty array
   * Removes timestamps from each log line and returns changed logs
   * @returns Logs without timestamps
   */
  get logsWithoutTimestamps(): string[] {
    return this.logs.map((item) => this.removeTimestamps(item));
  }

  /**
   * It gets timestamps from all logs then returns last one + 1 second
   * (this allows to avoid getting the last stamp in the selection)
   * @param tabId
   */
  getLastSinceTime(tabId: TabId): string {
    const logs = this.podLogs.get(tabId) ?? [];
    const [timestamp] = this.getTimestamps(logs[logs.length - 1]) ?? [];
    const stamp = timestamp ? new Date(timestamp) : new Date();

    stamp.setSeconds(stamp.getSeconds() + 1); // avoid duplicates from last second

    return stamp.toISOString();
  }

  splitOutTimestamp(logs: string): [string, string] {
    const extraction = /^(\d+\S+)(.*)/m.exec(logs);

    if (!extraction || extraction.length < 3) {
      return ["", logs];
    }

    return [extraction[1], extraction[2]];
  }

  getTimestamps(logs: string) {
    return logs.match(/^\d+\S+/gm);
  }

  removeTimestamps(logs: string): string {
    return logs.replace(/^\d+.*?\s/gm, "");
  }

  clearLogs(tabId: TabId): void {
    this.generations.set(tabId, this.getGeneration(tabId) + 1);
    this.podLogs.delete(tabId);
  }

  reload(
    tabId: TabId,
    computedPod: IComputedValue<Pod | undefined>,
    logTabData: IComputedValue<LogTabData | undefined>,
  ): Promise<void> {
    this.clearLogs(tabId);

    return this.load(tabId, computedPod, logTabData);
  }
}
