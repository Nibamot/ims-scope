/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Copyright (c) OpenLens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { getInjectable } from "@ogre-tools/injectable";
import homeDirectoryPathInjectable from "../../common/os/home-directory-path.injectable";
import getDirnameOfPathInjectable from "../../common/path/get-dirname.injectable";
import showOpenDialogInjectable from "../electron-app/features/show-open-dialog.injectable";
import showApplicationWindowInjectable from "../start-main-application/lens-window/show-application-window.injectable";

import type { RequestChannelHandler } from "@nibamot/messaging";

import type { openPathPickingDialogChannel } from "../../features/path-picking-dialog/common/channel";

// TODO: Replace leaking electron with abstraction
export type AskUserForFilePaths = RequestChannelHandler<typeof openPathPickingDialogChannel>;

const askUserForFilePathsInjectable = getInjectable({
  id: "ask-user-for-file-paths",

  instantiate: (di): AskUserForFilePaths => {
    const showApplicationWindow = di.inject(showApplicationWindowInjectable);
    const showOpenDialog = di.inject(showOpenDialogInjectable);
    const homeDirectoryPath = di.inject(homeDirectoryPathInjectable);
    const getDirnameOfPath = di.inject(getDirnameOfPathInjectable);

    // Since Electron 43 a dialog without a defaultPath opens in Downloads, and
    // the OS no longer brings back the directory last browsed. So the last one
    // is remembered here, for every caller that does not ask for its own.
    let lastUsedDirectory: string | undefined;

    return async (dialogOptions) => {
      await showApplicationWindow();

      const { canceled, filePaths } = await showOpenDialog({
        ...dialogOptions,
        defaultPath: dialogOptions.defaultPath ?? lastUsedDirectory ?? homeDirectoryPath,
      });

      if (filePaths.length > 0) {
        lastUsedDirectory = getDirnameOfPath(filePaths[0]);
      }

      if (canceled) {
        return {
          canceled,
        };
      }

      return {
        canceled: false,
        paths: filePaths,
      };
    };
  },
});

export default askUserForFilePathsInjectable;
