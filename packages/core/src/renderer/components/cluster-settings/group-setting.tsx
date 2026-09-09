/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { withInjectables } from "@ogre-tools/injectable-react";
import { action, autorun, makeObservable, observable } from "mobx";
import { observer } from "mobx-react";
import React from "react";
import CreatableSelect from "react-select/creatable";
import clusterGroupNamesInjectable from "../../../features/cluster/storage/common/cluster-group-names.injectable";
import { SubTitle } from "../layout/sub-title";

import type { IComputedValue } from "mobx";
import type { SingleValue } from "react-select";

import type { Cluster } from "../../../common/cluster/cluster";

export interface ClusterGroupSettingProps {
  cluster: Cluster;
}

interface Dependencies {
  clusterGroupNames: IComputedValue<string[]>;
}

interface GroupOption {
  value: string;
  label: string;
}

@observer
class NonInjectedClusterGroupSetting extends React.Component<ClusterGroupSettingProps & Dependencies> {
  private readonly disposers: (() => void)[] = [];

  @observable group = "";

  constructor(props: ClusterGroupSettingProps & Dependencies) {
    super(props);
    makeObservable(this);
  }

  componentDidMount() {
    const { cluster } = this.props;

    this.disposers.push(
      autorun(() => {
        this.group = cluster.preferences.group || "";
      }),
    );
  }

  componentWillUnmount() {
    this.disposers.forEach((dispose) => dispose());
  }

  onChange = action((option: SingleValue<GroupOption>) => {
    this.group = option?.value ?? "";
    this.props.cluster.preferences.group = this.group.trim() || undefined;
  });

  render() {
    const options: GroupOption[] = this.props.clusterGroupNames.get().map((group) => ({
      value: group,
      label: group,
    }));
    const value = this.group ? { value: this.group, label: this.group } : null;

    return (
      <>
        <SubTitle title="Group" />
        <CreatableSelect<GroupOption, false>
          className="Select theme-lens"
          classNamePrefix="Select"
          menuPortalTarget={document.body}
          styles={{ menuPortal: (styles) => ({ ...styles, zIndex: "auto" }) }}
          isClearable
          placeholder="Select or create a group..."
          formatCreateLabel={(inputValue) => `Create group "${inputValue}"`}
          options={options}
          value={value}
          onChange={this.onChange}
        />
        <small className="hint">
          Clusters sharing the same group tag are shown together in the hotbar sidebar when arranged adjacently. Pick an
          existing group to avoid creating a duplicate with a different spelling.
        </small>
      </>
    );
  }
}

export const ClusterGroupSetting = withInjectables<Dependencies, ClusterGroupSettingProps>(
  NonInjectedClusterGroupSetting,
  {
    getProps: (di, props) => ({
      ...props,
      clusterGroupNames: di.inject(clusterGroupNamesInjectable),
    }),
  },
);
