/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import directoryForUserDataInjectable from "../../common/app-paths/directory-for-user-data/directory-for-user-data.injectable";
import homeDirectoryPathInjectable from "../../common/os/home-directory-path.injectable";
import showOpenDialogInjectable from "../electron-app/features/show-open-dialog.injectable";
import { getDiForUnitTesting } from "../getDiForUnitTesting";
import showApplicationWindowInjectable from "../start-main-application/lens-window/show-application-window.injectable";
import askUserForFilePathsInjectable from "./ask-user-for-file-paths.injectable";

import type { Mock } from "vitest";

import type { AskUserForFilePaths } from "./ask-user-for-file-paths.injectable";

describe("ask-user-for-file-paths", () => {
  let askUserForFilePaths: AskUserForFilePaths;
  let showOpenDialog: Mock;

  beforeEach(() => {
    const di = getDiForUnitTesting();

    showOpenDialog = vi.fn();
    di.override(directoryForUserDataInjectable, () => "/some-directory-for-user-data");
    di.override(showApplicationWindowInjectable, () => async () => {});
    di.override(showOpenDialogInjectable, () => showOpenDialog);
    di.override(homeDirectoryPathInjectable, () => "/some-home");

    askUserForFilePaths = di.inject(askUserForFilePathsInjectable);
  });

  it("opens the first dialog in the home directory rather than Downloads", async () => {
    showOpenDialog.mockResolvedValue({ canceled: true, filePaths: [] });

    await askUserForFilePaths({ properties: ["openFile"] });

    expect(showOpenDialog).toHaveBeenCalledWith({ properties: ["openFile"], defaultPath: "/some-home" });
  });

  it("keeps a default path the caller gives", async () => {
    showOpenDialog.mockResolvedValue({ canceled: true, filePaths: [] });

    await askUserForFilePaths({ defaultPath: "/some-directory" });

    expect(showOpenDialog).toHaveBeenCalledWith({ defaultPath: "/some-directory" });
  });

  it("opens the next dialog where the last pick was made", async () => {
    showOpenDialog.mockResolvedValueOnce({ canceled: false, filePaths: ["/some/picked/file"] });
    expect(await askUserForFilePaths({})).toEqual({ canceled: false, paths: ["/some/picked/file"] });

    showOpenDialog.mockResolvedValueOnce({ canceled: true, filePaths: [] });
    await askUserForFilePaths({});

    expect(showOpenDialog).toHaveBeenLastCalledWith({ defaultPath: "/some/picked" });
  });
});
