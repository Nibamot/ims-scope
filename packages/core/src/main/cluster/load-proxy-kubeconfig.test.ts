/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import directoryForUserDataInjectable from "../../common/app-paths/directory-for-user-data/directory-for-user-data.injectable";
import readFileInjectable from "../../common/fs/read-file.injectable";
import { getDiForUnitTesting } from "../getDiForUnitTesting";
import kubeconfigManagerInjectable from "../kubeconfig-manager/kubeconfig-manager.injectable";
import lensProxyTokenInjectable from "../lens-proxy/lens-proxy-token.injectable";
import loadProxyKubeconfigInjectable from "./load-proxy-kubeconfig.injectable";

import type { Cluster } from "../../common/cluster/cluster";
import type { KubeconfigManager } from "../kubeconfig-manager/kubeconfig-manager";

const proxyKubeconfig = `apiVersion: v1
kind: Config
current-context: some-context
clusters:
- name: some-context
  cluster:
    server: https://127.0.0.1:4321/some-cluster-id
contexts:
- name: some-context
  context:
    cluster: some-context
    user: proxy
users:
- name: proxy
  user:
    exec:
      apiVersion: client.authentication.k8s.io/v1
      command: /some-bundled/freelens-k8s-proxy
      args: [credential]
      interactiveMode: Never
`;

describe("loadProxyKubeconfig", () => {
  it("gives in-process clients the token from memory instead of the credential plugin", async () => {
    const di = getDiForUnitTesting();
    const cluster = { id: "some-cluster-id" } as Cluster;

    di.override(directoryForUserDataInjectable, () => "/some-directory-for-user-data");
    di.override(readFileInjectable, () => async () => proxyKubeconfig);
    di.override(
      kubeconfigManagerInjectable,
      () => ({ ensurePath: async () => "/some-proxy-kubeconfig" }) as unknown as KubeconfigManager,
    );

    const config = await di.inject(loadProxyKubeconfigInjectable, cluster)();
    const [user] = config.users;

    expect(user.exec).toBeUndefined();
    expect(user.token).toBe(di.inject(lensProxyTokenInjectable).value);
  });
});
