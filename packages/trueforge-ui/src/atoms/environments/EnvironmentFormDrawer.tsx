'use client';

import { useEffect, useMemo, useState, type FormEvent } from 'react';

import { useToasterOptional } from '../../containers/ToasterContainer.js';
import { useSandboxEnvironmentServer } from '../../server/ServerContext.js';
import type { SandboxEnvironment, SandboxEnvironmentManifest } from '../../server/types.js';
import { getErrorMessage } from '../../utils/getErrorMessage.js';
import { CodeEditor } from '../CodeEditor.js';
import { cn } from '../lib/cn.js';
import { Button } from '../primitives/Button.js';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '../primitives/Dialog.js';
import { SideDrawer } from '../primitives/SideDrawer.js';
import { defaultEnvironmentManifest } from './environmentDisplay.js';
import {
  EnvironmentFormFields,
  formValuesToManifest,
  manifestToFormValues,
  validateEnvironmentForm,
  type EnvironmentFormValues,
} from './EnvironmentFormFields.js';
import { manifestToYaml, parseManifestYaml } from './environmentYaml.js';

export type EnvironmentFormDrawerProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: 'create' | 'edit';
  environment?: SandboxEnvironment;
  onSaved?: () => void;
};

type EditorMode = 'form' | 'yaml';

export function EnvironmentFormDrawer({ open, onOpenChange, mode, environment, onSaved }: EnvironmentFormDrawerProps) {
  const environmentServer = useSandboxEnvironmentServer();
  const toaster = useToasterOptional();
  const [editorMode, setEditorMode] = useState<EditorMode>('form');
  const [form, setForm] = useState<EnvironmentFormValues>(() => manifestToFormValues(defaultEnvironmentManifest()));
  const [yamlText, setYamlText] = useState(() => manifestToYaml(defaultEnvironmentManifest()));
  const [baselineForm, setBaselineForm] = useState(form);
  const [baselineYaml, setBaselineYaml] = useState(yamlText);
  const [pendingSwitch, setPendingSwitch] = useState<EditorMode | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setEditorMode('form');
      setError(null);
      setPendingSwitch(null);
      setSaving(false);
      return;
    }
    const manifest = mode === 'edit' && environment != null ? environment.manifest : defaultEnvironmentManifest();
    const nextForm = manifestToFormValues(manifest);
    const nextYaml = manifestToYaml(manifest);
    setForm(nextForm);
    setYamlText(nextYaml);
    setBaselineForm(nextForm);
    setBaselineYaml(nextYaml);
    setEditorMode('form');
    setError(null);
    setPendingSwitch(null);
  }, [open, mode, environment]);

  const formDirty = useMemo(() => JSON.stringify(form) !== JSON.stringify(baselineForm), [baselineForm, form]);
  const yamlDirty = yamlText !== baselineYaml;
  const dirty = editorMode === 'form' ? formDirty : yamlDirty;

  const requestSwitch = (next: EditorMode) => {
    if (next === editorMode) return;
    if (dirty) {
      setPendingSwitch(next);
      return;
    }
    applySwitch(next);
  };

  const applySwitch = (next: EditorMode) => {
    if (next === 'yaml') {
      const manifest = formValuesToManifest(form);
      const nextYaml = manifestToYaml(manifest);
      setYamlText(nextYaml);
      setBaselineYaml(nextYaml);
      setBaselineForm(form);
    } else {
      const parsed = parseManifestYaml(yamlText);
      if ('error' in parsed) {
        setError(parsed.error);
        setPendingSwitch(null);
        return;
      }
      const nextForm = manifestToFormValues(parsed.manifest);
      setForm(nextForm);
      setBaselineForm(nextForm);
      setBaselineYaml(yamlText);
    }
    setEditorMode(next);
    setPendingSwitch(null);
    setError(null);
  };

  const handleSave = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    let manifest: SandboxEnvironmentManifest;
    if (editorMode === 'form') {
      const validationError = validateEnvironmentForm(form);
      if (validationError != null) {
        setError(validationError);
        return;
      }
      manifest = formValuesToManifest(form);
    } else {
      const parsed = parseManifestYaml(yamlText);
      if ('error' in parsed) {
        setError(parsed.error);
        return;
      }
      manifest = parsed.manifest;
    }

    setSaving(true);
    try {
      await environmentServer.createOrUpdateEnvironment({ manifest });
      toaster?.showSuccess({
        title: mode === 'create' ? 'Environment created' : 'Environment updated',
      });
      onSaved?.();
      onOpenChange(false);
    } catch (caught) {
      setError(getErrorMessage(caught, 'Failed to save environment'));
    } finally {
      setSaving(false);
    }
  };

  const title = mode === 'create' ? 'New environment' : (environment?.name ?? 'Edit environment');

  return (
    <>
      <SideDrawer
        open={open}
        onOpenChange={onOpenChange}
        title={title}
        description="Configure the environment as a form or edit its manifest directly."
        size="xl"
        headerActions={
          <div className="inline-flex shrink-0 rounded-md bg-secondary-bg p-0.5 border border-border">
            <button
              type="button"
              className={cn(
                'rounded-sm px-2.5 py-1 text-xs font-medium transition-colors',
                editorMode === 'form'
                  ? 'bg-primary-bg text-text-primary shadow-xs'
                  : 'text-text-secondary hover:text-text-primary',
              )}
              onClick={() => requestSwitch('form')}
            >
              UI Form
            </button>
            <button
              type="button"
              className={cn(
                'rounded-sm px-2.5 py-1 text-xs font-medium transition-colors',
                editorMode === 'yaml'
                  ? 'bg-primary-bg text-text-primary shadow-xs'
                  : 'text-text-secondary hover:text-text-primary',
              )}
              onClick={() => requestSwitch('yaml')}
            >
              YAML
            </button>
          </div>
        }
        footer={
          <div className="flex justify-end gap-2">
            <Button.Secondary type="button" disabled={saving} onClick={() => onOpenChange(false)}>
              Cancel
            </Button.Secondary>
            <Button.Primary type="submit" form="environment-form" disabled={saving}>
              {saving ? 'Saving…' : mode === 'create' ? 'Create' : 'Save'}
            </Button.Primary>
          </div>
        }
      >
        <form
          id="environment-form"
          className={cn(
            'flex min-h-0 flex-1 flex-col gap-4 px-5 pt-4',
            editorMode === 'form' ? 'pb-10' : 'h-full pb-4',
          )}
          onSubmit={event => void handleSave(event)}
        >
          {error != null ? <p className="text-sm text-failure-bg">{error}</p> : null}

          {editorMode === 'form' ? (
            <EnvironmentFormFields values={form} onChange={setForm} nameDisabled={mode === 'edit'} />
          ) : (
            <div className="flex min-h-[30rem] flex-1 flex-col">
              <CodeEditor
                language="yaml"
                value={yamlText}
                height="100%"
                showToolbar={false}
                defaultShowLineNumbers
                className="flex-1"
                onChange={value => setYamlText(value)}
              />
            </div>
          )}
        </form>
      </SideDrawer>

      <Dialog open={pendingSwitch != null} onOpenChange={openDialog => !openDialog && setPendingSwitch(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Warning</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-text-secondary">
            {pendingSwitch === 'form'
              ? 'The YAML changes will be lost. Are you sure you want to switch to UI form?'
              : 'You might lose all your changes from the form. Are you sure you want to switch to YAML Editor?'}
          </p>
          <DialogFooter>
            <Button.Secondary type="button" onClick={() => setPendingSwitch(null)}>
              Cancel
            </Button.Secondary>
            <Button.Primary
              type="button"
              onClick={() => {
                if (pendingSwitch != null) applySwitch(pendingSwitch);
              }}
            >
              Yes
            </Button.Primary>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
