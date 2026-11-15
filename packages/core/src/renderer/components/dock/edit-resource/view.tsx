/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Copyright (c) OpenLens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { Button } from "@nibamot/button";
import { Spinner } from "@nibamot/spinner";
import { withInjectables } from "@ogre-tools/injectable-react";
import { observer } from "mobx-react";
import { Badge } from "../../badge";
import { Checkbox } from "../../checkbox";
import { Notice } from "../../extensions/notice";
import { EditorPanel } from "../editor-panel";
import { InfoPanel } from "../info-panel";
import editResourceModelInjectable from "./edit-resource-model/edit-resource-model.injectable";

import type { EditResourceModel } from "./edit-resource-model/edit-resource-model.injectable";

export interface EditResourceProps {
  tabId: string;
}

interface Dependencies {
  model: EditResourceModel;
}

const renderLoadFailure = (model: EditResourceModel, tabId: string, error: string) => (
  <Notice>
    <div className="flex gap-4 items-center">
      <span className="flex-grow">{error}</span>
      <Button label="Retry" onClick={model.load} data-testid={`retry-edit-resource-from-tab-for-${tabId}`} />
    </div>
  </Notice>
);

const NonInjectedEditResource = observer(({ model, tabId }: EditResourceProps & Dependencies) => {
  const loadState = model.loadState.get();

  if (loadState.status === "loading") {
    return <Spinner center data-testid="edit-resource-tab-spinner" />;
  }

  if (loadState.status === "failed") {
    return <div className="EditResource flex flex-col">{renderLoadFailure(model, tabId, loadState.error)}</div>;
  }

  return renderEditor(model, tabId);
});

const renderEditor = (model: EditResourceModel, tabId: string) => (
  <div className="EditResource flex flex-col">
    {model.shouldShowErrorAboutNoResource ? (
      <Notice>Resource not found</Notice>
    ) : (
      <>
        <InfoPanel
          tabId={tabId}
          error={model.configuration.error.value.get()}
          submit={model.save}
          showNotifications={false}
          submitLabel="Save"
          submittingMessage="Applying..."
          submitTestId={`save-edit-resource-from-tab-for-${tabId}`}
          submitAndCloseTestId={`save-and-close-edit-resource-from-tab-for-${tabId}`}
          cancelTestId={`cancel-edit-resource-from-tab-for-${tabId}`}
          submittingTestId={`saving-edit-resource-from-tab-for-${tabId}`}
          controls={
            <div className="resource-info flex gap-2 items-center">
              <span>Kind:</span>
              <Badge label={model.kind} />
              <span>Name:</span>
              <Badge label={model.name} />
              <span>Namespace:</span>
              <Badge label={model.namespace} />
              <Checkbox label="Sort" value={model.sortKeys.value.get()} onChange={model.sortKeys.onChange} />
              <Checkbox
                label="Managed Fields"
                value={model.managedFields.value.get()}
                onChange={model.managedFields.onChange}
              />
            </div>
          }
        />
        <EditorPanel
          tabId={tabId}
          value={model.configuration.value.get()}
          onChange={model.configuration.onChange}
          onError={model.configuration.error.onChange}
        />
      </>
    )}
  </div>
);

export const EditResource = withInjectables<Dependencies, EditResourceProps>(NonInjectedEditResource, {
  getPlaceholder: () => <Spinner center data-testid="edit-resource-tab-spinner" />,
  getProps: async (di, props) => ({
    ...props,
    model: await di.inject(editResourceModelInjectable, props.tabId),
  }),
});
