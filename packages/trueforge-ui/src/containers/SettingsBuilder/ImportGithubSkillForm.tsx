'use client';

import { useState, type SyntheticEvent } from 'react';

import { cn } from '@/atoms/lib/cn.js';
import { auiInputClass } from '@/atoms/lib/inputClasses.js';
import { Button } from '@/atoms/primitives/Button.js';
import { CenteredModal } from '@/atoms/primitives/CenteredModal.js';
import { Icon } from '@/icons/Icon.js';
import type { SkillConfigBase } from '../../server/types.js';
import {
  RequiredMark,
  SETTINGS_INPUT_ERROR_CLASS_NAME,
  SettingsFieldError,
  useTouchedFields,
} from './SettingsFormField.js';
import {
  validateGitPath,
  validateGitRef,
  validateGitRepositoryUrl,
  validateRequired,
  validateResourceName,
} from './settingsFormValidation.js';

type ImportGithubSkillFormProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onImport: (draft: SkillConfigBase) => void | Promise<void>;
  busy?: boolean;
  error?: string | null;
  existingNames?: readonly string[];
};

type SkillField = 'name' | 'description' | 'repoUrl' | 'path' | 'ref';
const SKILL_FIELDS: readonly SkillField[] = ['name', 'description', 'repoUrl', 'path', 'ref'];

const ImportGithubSkillForm = ({
  open,
  onOpenChange,
  onImport,
  busy = false,
  error,
  existingNames = [],
}: ImportGithubSkillFormProps) => {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [repoURL, setRepoURL] = useState('');
  const [path, setPath] = useState('');
  const [ref, setRef] = useState('');
  const { isTouched, resetTouched, touch, touchAll } = useTouchedFields<SkillField>();

  const reset = () => {
    setName('');
    setDescription('');
    setRepoURL('');
    setPath('');
    setRef('');
    resetTouched();
  };

  const close = () => {
    reset();
    onOpenChange(false);
  };

  const handleSubmit = async (event: SyntheticEvent<HTMLFormElement, SubmitEvent>) => {
    event.preventDefault();
    touchAll(SKILL_FIELDS);
    if (!isValid || busy) return;

    try {
      await onImport({
        name: name.trim(),
        description: description.trim(),
        repoURL: repoURL.trim(),
        path: path.trim(),
        ref: ref.trim(),
      });
      close();
    } catch {
      // Parent surfaces error; keep form open.
    }
  };

  const nameError = validateResourceName({ value: name, label: 'Skill name', existingNames });
  const descriptionError = validateRequired({ value: description, label: 'Description' });
  const repoUrlError = validateGitRepositoryUrl(repoURL);
  const pathError = validateGitPath(path);
  const refError = validateGitRef(ref);
  const isValid = !nameError && !descriptionError && !repoUrlError && !pathError && !refError;
  const canImport = isValid && !busy;

  return (
    <CenteredModal
      open={open}
      onOpenChange={nextOpen => {
        if (!nextOpen) close();
      }}
      title="Import from GitHub"
      description="Import a skill from a SKILL.md file in a GitHub repository."
      headerIcon={
        <span className="flex size-11 shrink-0 items-center justify-center rounded-lg border border-border bg-secondary-bg text-text-primary">
          <Icon name="github" className="size-5" />
        </span>
      }
      contentSized
      className="md:max-w-2xl"
    >
      <form noValidate onSubmit={e => void handleSubmit(e)}>
        <div className="space-y-5 px-5 py-5 md:px-6">
          <div>
            <label htmlFor="skill-name" className="mb-2 block text-sm font-semibold text-text-primary">
              Name
              <RequiredMark />
            </label>
            <input
              id="skill-name"
              value={name}
              onChange={event => {
                setName(event.target.value);
              }}
              onBlur={() => touch('name')}
              placeholder="release-notes"
              autoFocus
              required
              aria-invalid={isTouched('name') && nameError ? true : undefined}
              aria-describedby={isTouched('name') && nameError ? 'skill-name-error' : undefined}
              className={cn(auiInputClass('h-11'), isTouched('name') && nameError && SETTINGS_INPUT_ERROR_CLASS_NAME)}
            />
            {isTouched('name') && nameError ? (
              <SettingsFieldError id="skill-name-error">{nameError}</SettingsFieldError>
            ) : null}
          </div>

          <div>
            <label htmlFor="skill-description" className="mb-2 block text-sm font-semibold text-text-primary">
              Description
              <RequiredMark />
            </label>
            <textarea
              id="skill-description"
              value={description}
              onChange={event => {
                setDescription(event.target.value);
              }}
              onBlur={() => touch('description')}
              placeholder="Generate release notes from merged pull requests"
              required
              rows={3}
              aria-invalid={isTouched('description') && descriptionError ? true : undefined}
              aria-describedby={isTouched('description') && descriptionError ? 'skill-description-error' : undefined}
              className={cn(
                auiInputClass('resize-y py-2.5'),
                isTouched('description') && descriptionError && SETTINGS_INPUT_ERROR_CLASS_NAME,
              )}
            />
            {isTouched('description') && descriptionError ? (
              <SettingsFieldError id="skill-description-error">{descriptionError}</SettingsFieldError>
            ) : null}
          </div>

          <div>
            <label htmlFor="skill-repo-url" className="mb-2 block text-sm font-semibold text-text-primary">
              Repository URL
              <RequiredMark />
            </label>
            <input
              id="skill-repo-url"
              type="url"
              value={repoURL}
              onChange={event => {
                setRepoURL(event.target.value);
              }}
              onBlur={() => touch('repoUrl')}
              placeholder="https://github.com/org/repo"
              required
              aria-invalid={isTouched('repoUrl') && repoUrlError ? true : undefined}
              aria-describedby={isTouched('repoUrl') && repoUrlError ? 'skill-repo-url-error' : undefined}
              className={cn(
                auiInputClass('h-11'),
                isTouched('repoUrl') && repoUrlError && SETTINGS_INPUT_ERROR_CLASS_NAME,
              )}
            />
            {isTouched('repoUrl') && repoUrlError ? (
              <SettingsFieldError id="skill-repo-url-error">{repoUrlError}</SettingsFieldError>
            ) : null}
          </div>

          <div>
            <label htmlFor="skill-path" className="mb-2 block text-sm font-semibold text-text-primary">
              Folder containing the SKILL.md
              <RequiredMark />
            </label>
            <input
              id="skill-path"
              value={path}
              onChange={event => {
                setPath(event.target.value);
              }}
              onBlur={() => touch('path')}
              placeholder="skills/release-notes"
              required
              aria-invalid={isTouched('path') && pathError ? true : undefined}
              aria-describedby={isTouched('path') && pathError ? 'skill-path-error' : undefined}
              className={cn(auiInputClass('h-11'), isTouched('path') && pathError && SETTINGS_INPUT_ERROR_CLASS_NAME)}
            />
            {isTouched('path') && pathError ? (
              <SettingsFieldError id="skill-path-error">{pathError}</SettingsFieldError>
            ) : null}
          </div>

          <div>
            <label htmlFor="skill-ref" className="mb-2 block text-sm font-semibold text-text-primary">
              Branch
              <RequiredMark />
            </label>
            <input
              id="skill-ref"
              value={ref}
              onChange={event => {
                setRef(event.target.value);
              }}
              onBlur={() => touch('ref')}
              placeholder="main"
              required
              aria-invalid={isTouched('ref') && refError ? true : undefined}
              aria-describedby={isTouched('ref') && refError ? 'skill-ref-error' : undefined}
              className={cn(auiInputClass('h-11'), isTouched('ref') && refError && SETTINGS_INPUT_ERROR_CLASS_NAME)}
            />
            {isTouched('ref') && refError ? (
              <SettingsFieldError id="skill-ref-error">{refError}</SettingsFieldError>
            ) : null}
          </div>

          <div className="space-y-3">
            {error ? <p className="text-failure-bg text-sm">{error}</p> : null}
            <Button type="submit" disabled={!canImport} className="w-full">
              Import
            </Button>
          </div>
        </div>
      </form>
    </CenteredModal>
  );
};

export default ImportGithubSkillForm;
