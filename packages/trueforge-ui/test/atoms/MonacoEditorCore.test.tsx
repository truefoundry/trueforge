// @vitest-environment jsdom
import { act, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MonacoEditorCore } from '@/atoms/MonacoEditorCore.js';

const monacoMocks = vi.hoisted(() => {
  let changeListener: (() => void) | undefined;
  let sizeListener: (() => void) | undefined;

  const changeDisposable = { dispose: vi.fn() };
  const sizeDisposable = { dispose: vi.fn() };
  const editor = {
    getValue: vi.fn(() => 'initial value'),
    setValue: vi.fn(),
    getContentHeight: vi.fn(() => 72),
    onDidChangeModelContent: vi.fn((listener: () => void) => {
      changeListener = listener;
      return changeDisposable;
    }),
    onDidContentSizeChange: vi.fn((listener: () => void) => {
      sizeListener = listener;
      return sizeDisposable;
    }),
    updateOptions: vi.fn(),
    dispose: vi.fn(),
    layout: vi.fn(),
  };
  const editorApi = {
    create: vi.fn(() => editor),
    defineTheme: vi.fn(),
    setTheme: vi.fn(),
  };

  return {
    module: { editor: editorApi },
    editor,
    editorApi,
    changeDisposable,
    sizeDisposable,
    invokeChange: () => changeListener?.(),
    invokeSizeChange: () => sizeListener?.(),
  };
});

vi.mock('monaco-editor', () => monacoMocks.module);

describe('MonacoEditorCore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    monacoMocks.editor.getValue.mockReturnValue('initial value');
    monacoMocks.editor.getContentHeight.mockReturnValue(72);
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });
  });

  afterEach(() => vi.unstubAllGlobals());

  it('creates Monaco with consumer options and forwards lifecycle and change callbacks', async () => {
    const beforeMount = vi.fn();
    const onMount = vi.fn();
    const onChange = vi.fn();
    const { unmount } = render(
      <MonacoEditorCore
        value="initial value"
        language="typescript"
        theme="custom-theme"
        options={{ readOnly: true, lineNumbers: 'off' }}
        beforeMount={beforeMount}
        onMount={onMount}
        onChange={onChange}
      />,
    );

    await waitFor(() => expect(monacoMocks.editorApi.create).toHaveBeenCalledOnce());
    expect(monacoMocks.editorApi.defineTheme).toHaveBeenCalledTimes(2);
    expect(beforeMount).toHaveBeenCalledWith(monacoMocks.module);
    expect(monacoMocks.editorApi.create).toHaveBeenCalledWith(
      expect.any(HTMLElement),
      expect.objectContaining({
        value: 'initial value',
        language: 'typescript',
        theme: 'custom-theme',
        readOnly: true,
        lineNumbers: 'off',
      }),
    );
    expect(onMount).toHaveBeenCalledWith(monacoMocks.editor, monacoMocks.module);

    monacoMocks.editor.getValue.mockReturnValue('edited value');
    act(() => monacoMocks.invokeChange());
    expect(onChange).toHaveBeenCalledWith('edited value');

    unmount();
    expect(monacoMocks.changeDisposable.dispose).toHaveBeenCalledOnce();
    expect(monacoMocks.editor.dispose).toHaveBeenCalledOnce();
  });

  it('syncs external values without recreating the editor', async () => {
    const { rerender } = render(<MonacoEditorCore value="first" />);
    await waitFor(() => expect(monacoMocks.editorApi.create).toHaveBeenCalledOnce());

    monacoMocks.editor.getValue.mockReturnValue('first');
    rerender(<MonacoEditorCore value="second" />);

    await waitFor(() => expect(monacoMocks.editor.setValue).toHaveBeenCalledWith('second'));
    expect(monacoMocks.editorApi.create).toHaveBeenCalledOnce();
  });

  it('clamps auto-height and responds to Monaco content-size changes', async () => {
    monacoMocks.editor.getContentHeight.mockReturnValue(500);
    const onAutoHeightChange = vi.fn();
    const { container, unmount } = render(
      <MonacoEditorCore
        value={'one\ntwo'}
        autoHeight
        minHeight={30}
        maxHeight={100}
        onAutoHeightChange={onAutoHeightChange}
      />,
    );

    await waitFor(() => expect(monacoMocks.editorApi.create).toHaveBeenCalledOnce());
    const editorContainer = container.querySelector('.aui-monaco');
    expect(editorContainer).toHaveStyle({ height: '100px' });
    expect(monacoMocks.editor.layout).toHaveBeenCalled();
    expect(onAutoHeightChange).toHaveBeenLastCalledWith(100);

    monacoMocks.editor.getContentHeight.mockReturnValue(10);
    act(() => monacoMocks.invokeSizeChange());
    expect(editorContainer).toHaveStyle({ height: '30px' });
    expect(onAutoHeightChange).toHaveBeenLastCalledWith(30);

    unmount();
    expect(monacoMocks.sizeDisposable.dispose).toHaveBeenCalledOnce();
  });
});
