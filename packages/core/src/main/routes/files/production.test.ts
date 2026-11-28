/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import directoryForUserDataInjectable from "../../../common/app-paths/directory-for-user-data/directory-for-user-data.injectable";
import readFileBufferInjectable from "../../../common/fs/read-file-buffer.injectable";
import staticFilesDirectoryInjectable from "../../../common/vars/static-files-directory.injectable";
import { getDiForUnitTesting } from "../../getDiForUnitTesting";
import prodStaticFileRouteHandlerInjectable from "./production.injectable";

import type { LensApiRequest } from "../../router/route";

describe("production static file route", () => {
  let readFiles: string[];
  let handler: (request: LensApiRequest<"/{path*}">) => Promise<{ statusCode?: number; response?: unknown }>;

  beforeEach(() => {
    const di = getDiForUnitTesting();

    readFiles = [];
    di.override(directoryForUserDataInjectable, () => "/some-directory-for-user-data");
    di.override(staticFilesDirectoryInjectable, () => "/some-app/static");
    di.override(readFileBufferInjectable, () => async (filePath: string) => {
      readFiles.push(filePath);

      return Buffer.from("some-content");
    });

    handler = di.inject(prodStaticFileRouteHandlerInjectable) as typeof handler;
  });

  const get = (path: string) => handler({ params: { path } } as unknown as LensApiRequest<"/{path*}">);

  it("serves a file inside the static directory", async () => {
    expect((await get("build/some-chunk.js")).response).toEqual(Buffer.from("some-content"));
    expect(readFiles).toEqual(["/some-app/static/build/some-chunk.js"]);
  });

  it.each([
    ["a sibling directory sharing its prefix", "../static-other/secret.js"],
    ["a parent directory", "../../etc/passwd.txt"],
    ["a path that climbs out after descending", "build/../../outside.js"],
  ])("refuses %s without reading it", async (_, path) => {
    expect((await get(path)).statusCode).toBe(404);
    expect(readFiles).toEqual([]);
  });
});
