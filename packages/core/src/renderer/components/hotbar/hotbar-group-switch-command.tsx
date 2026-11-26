/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { withInjectables } from "@ogre-tools/injectable-react";
import { observer } from "mobx-react";
import commandOverlayInjectable from "../command-palette/command-overlay.injectable";
import { Select } from "../select";
import hotbarGroupCycleInjectable from "./hotbar-group-cycle.injectable";

import type { CommandOverlay } from "../command-palette";
import type { HotbarGroupCycle } from "./hotbar-group-cycle.injectable";

interface Dependencies {
  groupCycle: HotbarGroupCycle;
  commandOverlay: CommandOverlay;
}

const allGroups = "";

const NonInjectedHotbarGroupSwitchCommand = observer(({ groupCycle, commandOverlay }: Dependencies) => (
  <Select
    id="switch-to-hotbar-group-input"
    menuPortalTarget={null}
    onChange={(option) => {
      if (!option) {
        return;
      }

      groupCycle.select(option.value || undefined);
      commandOverlay.close();
    }}
    components={{ DropdownIndicator: null, IndicatorSeparator: null }}
    menuIsOpen={true}
    options={[
      { value: allGroups, label: "All" },
      ...groupCycle.groups.get().map((group) => ({
        value: group.key,
        label: `${group.label} (${group.entities.length})`,
      })),
    ]}
    autoFocus={true}
    escapeClearsValue={false}
    isClearable={false}
    placeholder="Switch to group"
  />
));

export const HotbarGroupSwitchCommand = withInjectables<Dependencies>(NonInjectedHotbarGroupSwitchCommand, {
  getProps: (di, props) => ({
    ...props,
    groupCycle: di.inject(hotbarGroupCycleInjectable),
    commandOverlay: di.inject(commandOverlayInjectable),
  }),
});
