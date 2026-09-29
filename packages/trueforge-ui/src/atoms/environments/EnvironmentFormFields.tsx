'use client';

import { Icon } from '../../icons/Icon.js';
import type { SandboxEnvironmentManifest, SandboxEnvironmentSecret } from '../../server/types.js';
import { auiButtonClass } from '../lib/buttonClasses.js';
import { cn } from '../lib/cn.js';
import { Button } from '../primitives/Button.js';
import { isReservedEnvironmentName } from './environmentDisplay.js';

export type EnvironmentFormValues = {
  name: string;
  description: string;
  buildScript: string;
  cpu: string;
  memory: string;
  disk: string;
  networkBlockAll: boolean;
  domainAllowList: string;
  secrets: SandboxEnvironmentSecret[];
  environmentVariables: Array<{ key: string; value: string }>;
};

export function manifestToFormValues(manifest: SandboxEnvironmentManifest): EnvironmentFormValues {
  return {
    name: manifest.name,
    description: manifest.description ?? '',
    buildScript: manifest.image?.buildScript ?? '',
    cpu: String(manifest.resources?.cpu ?? 1),
    memory: String(manifest.resources?.memory ?? 1),
    disk: String(manifest.resources?.disk ?? 3),
    networkBlockAll: manifest.networking?.networkBlockAll === true,
    domainAllowList: manifest.networking?.domainAllowList ?? '',
    secrets: manifest.networking?.secrets?.map(secret => ({ ...secret, hosts: [...secret.hosts] })) ?? [],
    environmentVariables: Object.entries(manifest.environmentVariables ?? {}).map(([key, value]) => ({
      key,
      value,
    })),
  };
}

export function formValuesToManifest(values: EnvironmentFormValues): SandboxEnvironmentManifest {
  const cpu = Number(values.cpu);
  const memory = Number(values.memory);
  const disk = Number(values.disk);
  const environmentVariables = Object.fromEntries(
    values.environmentVariables
      .map(row => [row.key.trim(), row.value] as const)
      .filter(([key, value]) => key.length > 0 && value.length > 0),
  );
  const secrets = values.networkBlockAll
    ? undefined
    : values.secrets
        .map(secret => ({
          env: secret.env.trim(),
          value: secret.value,
          hosts: secret.hosts.map(host => host.trim()).filter(host => host.length > 0),
        }))
        .filter(secret => secret.env.length > 0 && secret.value.length > 0);

  return {
    name: values.name.trim(),
    ...(values.description.trim().length === 0 ? {} : { description: values.description.trim() }),
    ...(values.buildScript.trim().length === 0
      ? {}
      : { image: { type: 'build', buildScript: values.buildScript } }),
    resources: {
      cpu: Number.isFinite(cpu) && cpu > 0 ? cpu : 1,
      memory: Number.isFinite(memory) && memory > 0 ? memory : 1,
      disk: Number.isFinite(disk) && disk > 0 ? disk : 3,
    },
    ...(Object.keys(environmentVariables).length === 0 ? {} : { environmentVariables }),
    networking: values.networkBlockAll
      ? { networkBlockAll: true }
      : {
          networkBlockAll: false,
          ...(values.domainAllowList.trim().length === 0
            ? {}
            : { domainAllowList: values.domainAllowList.trim() }),
          ...(secrets == null || secrets.length === 0 ? {} : { secrets }),
        },
  };
}

export function validateEnvironmentForm(values: EnvironmentFormValues): string | null {
  const name = values.name.trim();
  if (name.length === 0) return 'Name is required';
  if (isReservedEnvironmentName(name)) return 'Name "default" is reserved';
  const cpu = Number(values.cpu);
  const memory = Number(values.memory);
  const disk = Number(values.disk);
  if (!Number.isFinite(cpu) || cpu <= 0) return 'CPU must be a positive number';
  if (!Number.isFinite(memory) || memory <= 0) return 'Memory must be a positive number';
  if (!Number.isFinite(disk) || disk <= 0) return 'Disk must be a positive number';
  if (!values.networkBlockAll) {
    for (const secret of values.secrets) {
      if (secret.env.trim().length === 0) continue;
      if (secret.value.trim().length === 0) return 'Secret value is required';
    }
  }
  return null;
}

const fieldClassName =
  'w-full rounded-md border border-border bg-primary-bg px-2 py-1.5 text-sm text-text-primary outline-none focus:border-primary-button-bg';
const labelClassName = 'text-sm font-medium text-text-primary';

export function EnvironmentFormFields({
  values,
  onChange,
  nameDisabled,
}: {
  values: EnvironmentFormValues;
  onChange: (next: EnvironmentFormValues) => void;
  nameDisabled?: boolean;
}) {
  const update = (patch: Partial<EnvironmentFormValues>) => onChange({ ...values, ...patch });

  return (
    <div className="flex flex-col gap-5">
      <label className="flex flex-col gap-1.5">
        <span className={labelClassName}>Name</span>
        <input
          className={cn(fieldClassName, nameDisabled && 'opacity-70')}
          value={values.name}
          disabled={nameDisabled}
          placeholder="my-environment"
          onChange={event => update({ name: event.target.value })}
        />
      </label>

      <label className="flex flex-col gap-1.5">
        <span className={labelClassName}>Description</span>
        <textarea
          className={cn(fieldClassName, 'min-h-20 resize-y')}
          value={values.description}
          placeholder="Optional description"
          onChange={event => update({ description: event.target.value })}
        />
      </label>

      <label className="flex flex-col gap-1.5">
        <span className={labelClassName}>Build script</span>
        <textarea
          className={cn(fieldClassName, 'min-h-28 resize-y font-mono text-xs')}
          value={values.buildScript}
          placeholder={'set -ex\npip install httpx\n'}
          onChange={event => update({ buildScript: event.target.value })}
        />
      </label>

      <fieldset className="flex flex-col gap-2">
        <legend className={cn(labelClassName, 'mb-2')}>Resources</legend>
        <div className="grid grid-cols-3 gap-3">
          <label className="flex flex-col gap-1">
            <span className="text-xs text-text-secondary">CPU</span>
            <input
              className={fieldClassName}
              type="number"
              min={0.1}
              step="any"
              value={values.cpu}
              onChange={event => update({ cpu: event.target.value })}
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs text-text-secondary">Memory (GiB)</span>
            <input
              className={fieldClassName}
              type="number"
              min={0.1}
              step="any"
              value={values.memory}
              onChange={event => update({ memory: event.target.value })}
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs text-text-secondary">Disk (GiB)</span>
            <input
              className={fieldClassName}
              type="number"
              min={0.1}
              step="any"
              value={values.disk}
              onChange={event => update({ disk: event.target.value })}
            />
          </label>
        </div>
      </fieldset>

      <fieldset className="flex flex-col gap-3">
        <legend className={cn(labelClassName, 'mb-2')}>Networking</legend>
        <label className="flex items-center gap-2 text-sm text-text-primary">
          <input
            type="checkbox"
            checked={values.networkBlockAll}
            onChange={event => update({ networkBlockAll: event.target.checked })}
          />
          Block all outbound network access
        </label>
        {!values.networkBlockAll ? (
          <label className="flex flex-col gap-1.5">
            <span className="text-xs text-text-secondary">Allowed domains (comma-separated)</span>
            <input
              className={fieldClassName}
              value={values.domainAllowList}
              placeholder="api.example.com,*.npmjs.org"
              onChange={event => update({ domainAllowList: event.target.value })}
            />
          </label>
        ) : null}
      </fieldset>

      {!values.networkBlockAll ? (
        <fieldset className="flex flex-col gap-2">
          <legend className={cn(labelClassName, 'mb-2')}>Secrets</legend>
          {values.secrets.map((secret, index) => (
            <div key={index} className="flex flex-col gap-2 rounded-md border border-border p-3">
              <div className="flex items-start justify-between gap-2">
                <label className="flex min-w-0 flex-1 flex-col gap-1">
                  <span className="text-xs text-text-secondary">Env var</span>
                  <input
                    className={fieldClassName}
                    value={secret.env}
                    onChange={event => {
                      const secrets = values.secrets.map((row, i) =>
                        i === index ? { ...row, env: event.target.value } : row,
                      );
                      update({ secrets });
                    }}
                  />
                </label>
                <button
                  type="button"
                  className={auiButtonClass({ variant: 'ghost', size: 'icon', className: 'mt-5' })}
                  aria-label="Remove secret"
                  onClick={() => update({ secrets: values.secrets.filter((_, i) => i !== index) })}
                >
                  <Icon name="trash" className="size-3.5" />
                </button>
              </div>
              <label className="flex flex-col gap-1">
                <span className="text-xs text-text-secondary">Value</span>
                <input
                  className={fieldClassName}
                  type="password"
                  value={secret.value}
                  placeholder="Secret value"
                  onChange={event => {
                    const secrets = values.secrets.map((row, i) =>
                      i === index ? { ...row, value: event.target.value } : row,
                    );
                    update({ secrets });
                  }}
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-xs text-text-secondary">Hosts (comma-separated)</span>
                <input
                  className={fieldClassName}
                  value={secret.hosts.join(',')}
                  onChange={event => {
                    const hosts = event.target.value.split(',').map(part => part.trim());
                    const secrets = values.secrets.map((row, i) => (i === index ? { ...row, hosts } : row));
                    update({ secrets });
                  }}
                />
              </label>
            </div>
          ))}
          <Button.Secondary
            type="button"
            onClick={() => update({ secrets: [...values.secrets, { env: '', value: '', hosts: [] }] })}
          >
            <Icon name="plus" className="size-3.5" />
            Add Secret
          </Button.Secondary>
        </fieldset>
      ) : null}

      <fieldset className="flex flex-col gap-2">
        <legend className={cn(labelClassName, 'mb-2')}>Environment variables</legend>
        {values.environmentVariables.map((row, index) => (
          <div key={index} className="flex items-end gap-2">
            <label className="flex min-w-0 flex-1 flex-col gap-1">
              <span className="text-xs text-text-secondary">Key</span>
              <input
                className={fieldClassName}
                value={row.key}
                onChange={event => {
                  const environmentVariables = values.environmentVariables.map((item, i) =>
                    i === index ? { ...item, key: event.target.value } : item,
                  );
                  update({ environmentVariables });
                }}
              />
            </label>
            <label className="flex min-w-0 flex-1 flex-col gap-1">
              <span className="text-xs text-text-secondary">Value</span>
              <input
                className={fieldClassName}
                value={row.value}
                onChange={event => {
                  const environmentVariables = values.environmentVariables.map((item, i) =>
                    i === index ? { ...item, value: event.target.value } : item,
                  );
                  update({ environmentVariables });
                }}
              />
            </label>
            <button
              type="button"
              className={auiButtonClass({ variant: 'ghost', size: 'icon' })}
              aria-label="Remove environment variable"
              onClick={() =>
                update({ environmentVariables: values.environmentVariables.filter((_, i) => i !== index) })
              }
            >
              <Icon name="trash" className="size-3.5" />
            </button>
          </div>
        ))}
        <Button.Secondary
          type="button"
          onClick={() => update({ environmentVariables: [...values.environmentVariables, { key: '', value: '' }] })}
        >
          <Icon name="plus" className="size-3.5" />
          Add variable
        </Button.Secondary>
      </fieldset>
    </div>
  );
}
