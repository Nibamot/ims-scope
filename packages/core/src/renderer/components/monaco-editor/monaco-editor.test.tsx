/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { act } from "@testing-library/react";
import { editor } from "monaco-editor";
import { useState } from "react";
import { getDiForUnitTesting } from "../../getDiForUnitTesting";
import { renderFor } from "../test-utils/renderFor";
import { MonacoEditor } from "./monaco-editor";

import type { DiRender } from "../test-utils/renderFor";

vi.unmock("./monaco-editor");

const createFakeEditor = () => {
  const disposable = { dispose: vi.fn() };

  return {
    getContainerDomNode: () => document.createElement("div"),
    onDidLayoutChange: () => disposable,
    onDidChangeModelContent: () => disposable,
    onDidContentSizeChange: () => disposable,
    getValue: () => "some-value",
    setValue: vi.fn(),
    updateOptions: vi.fn(),
    layout: vi.fn(),
    focus: vi.fn(),
    setModel: vi.fn(),
    saveViewState: () => null,
    restoreViewState: vi.fn(),
    dispose: vi.fn(),
  };
};

describe("<MonacoEditor />", () => {
  let render: DiRender;
  let rerenderParent: () => void;

  const Parent = () => {
    const [, setCount] = useState(0);

    rerenderParent = () => setCount((count) => count + 1);

    // Inline style and options: new identities on every parent render, as in
    // the ConfigMap details drawer.
    return <MonacoEditor id="some-id" value="some-value" style={{ resize: "vertical" }} options={{}} />;
  };

  beforeEach(() => {
    globalThis.ResizeObserver ??= class {
      observe() {}
      unobserve() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver;

    const model = { getLineCount: () => 1, uri: {} };

    vi.mocked(editor.getModel).mockReturnValue(model as any);
    vi.mocked(editor.create).mockImplementation(() => createFakeEditor() as any);

    render = renderFor(getDiForUnitTesting());
  });

  it("settles after its parent re-renders", async () => {
    render(<Parent />);
    await act(async () => {});

    vi.mocked(editor.getModel).mockClear();

    // React 19 copies a class component's props into a new object on every
    // render when it declares defaultProps, so a props snapshot taken on each
    // update kept re-triggering the editor's own render: the renderer spun at
    // 100% CPU after any parent re-render (e.g. clicking Save on a ConfigMap).
    await act(async () => rerenderParent());

    // Each render reads the model once (for the initial height); a few
    // renders are expected, an endless loop is not.
    expect(vi.mocked(editor.getModel).mock.calls.length).toBeLessThan(10);
  });
});
