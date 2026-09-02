'use client';

import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';

import { useToasterOptional } from '../../containers/ToasterContainer.js';
import { Icon } from '../../icons/Icon.js';
import { useScheduleServer, useServer } from '../../server/ServerContext.js';
import { libraryAgentId } from '../../server/ShellModeContext.js';
import type { AgentLibraryEntry, Schedule } from '../../server/types.js';
import { DraftCatalogProvider } from '../draft/DraftCatalogProvider.js';
import { mountName } from '../lib/mountName.js';
import { searchAllAgents } from '../lib/useSearchAgentsList.js';
import { Button } from '../primitives/Button.js';
import { SideDrawer } from '../primitives/SideDrawer.js';
import {
  cronToFormValues,
  defaultScheduleFormValues,
  formatCadenceSummary,
  valuesToCron,
  type ScheduleFormValues,
} from './cadence.js';
import { ScheduleFormFields } from './ScheduleFormFields.js';
import { TestScheduleScreen } from './TestScheduleScreen.js';

export type ScheduleFormDrawerProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: 'create' | 'edit';
  schedule?: Schedule;
  initialAgentId?: string;
  onSaved?: () => void;
};

type DrawerView = { kind: 'form'; saved?: Schedule } | { kind: 'test'; schedule: Schedule };

function ScheduleFormDrawerBody({
  open,
  onOpenChange,
  mode,
  schedule,
  initialAgentId = '',
  onSaved,
}: ScheduleFormDrawerProps) {
  const scheduleServer = useScheduleServer();
  const server = useServer();
  const toaster = useToasterOptional();
  const [form, setForm] = useState<ScheduleFormValues>(defaultScheduleFormValues);
  const [agentId, setAgentId] = useState(initialAgentId);
  const [agents, setAgents] = useState<AgentLibraryEntry[]>([]);
  const [view, setView] = useState<DrawerView>({ kind: 'form' });
  const [saving, setSaving] = useState(false);
  const [activating, setActivating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const savedFromCreate = view.kind === 'form' ? view.saved : view.schedule;
  const isExternalEdit = mode === 'edit' && view.kind === 'form' && view.saved == null && schedule != null;
  const isCreatedEdit = view.kind === 'form' && view.saved != null;

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void searchAllAgents(server)
      .then(rows => {
        if (cancelled) return;
        setAgents(rows);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [open, server]);

  useEffect(() => {
    if (!open) {
      setForm(defaultScheduleFormValues());
      setAgentId(initialAgentId);
      setError(null);
      setView({ kind: 'form' });
      setActivating(false);
      return;
    }
    if (mode === 'edit' && schedule != null) {
      setForm(
        cronToFormValues({
          name: schedule.name,
          task: schedule.task,
          cron: schedule.cron,
          timezone: schedule.timezone,
        }),
      );
      setAgentId(schedule.agentId);
      setView({ kind: 'form' });
      return;
    }
    setForm(defaultScheduleFormValues());
    setAgentId(initialAgentId);
    setView({ kind: 'form' });
  }, [open, mode, schedule, initialAgentId]);

  const agentOptions = useMemo(
    () => agents.map(agent => ({ agentId: libraryAgentId(agent), name: agent.name })),
    [agents],
  );

  const selectedAgent = useMemo(
    () => agents.find(agent => libraryAgentId(agent) === agentId) ?? null,
    [agents, agentId],
  );

  const agentLabel =
    selectedAgent?.name ??
    savedFromCreate?.agentName ??
    schedule?.agentName ??
    agentOptions.find(option => option.agentId === agentId)?.name ??
    agentId;

  const mcpMounts = useMemo(() => {
    const mounts = selectedAgent?.agentSpec?.mcpServers ?? [];
    return mounts
      .map(mountName)
      .filter((name: string | null): name is string => name != null)
      .map(name => ({ name }));
  }, [selectedAgent]);

  const canSubmit = useMemo(() => {
    const cron = valuesToCron(form);
    return form.name.trim().length > 0 && form.task.trim().length > 0 && cron.length > 0 && agentId.length > 0;
  }, [form, agentId]);

  const enterTestView = (saved: Schedule) => {
    setView({ kind: 'test', schedule: saved });
    setForm(
      cronToFormValues({
        name: saved.name,
        task: saved.task,
        cron: saved.cron,
        timezone: saved.timezone,
      }),
    );
    setAgentId(saved.agentId);
  };

  const handleSave = async (event: FormEvent) => {
    event.preventDefault();
    if (!canSubmit) return;
    const cron = valuesToCron(form);
    setSaving(true);
    setError(null);
    try {
      if (isExternalEdit && schedule != null) {
        await scheduleServer.updateSchedule({
          id: schedule.id,
          name: form.name.trim(),
          task: form.task.trim(),
          cron,
          timezone: form.timezone,
          status: schedule.status,
        });
        onSaved?.();
        onOpenChange(false);
        return;
      }

      if (isCreatedEdit && view.kind === 'form' && view.saved != null) {
        const saved = await scheduleServer.updateSchedule({
          id: view.saved.id,
          name: form.name.trim(),
          task: form.task.trim(),
          cron,
          timezone: form.timezone,
          status: 'paused',
        });
        onSaved?.();
        enterTestView(saved);
        toaster?.showSuccess({
          title: 'Schedule saved as paused',
          description: formatCadenceSummary({ cron: saved.cron, timezone: saved.timezone }),
        });
        return;
      }

      const saved = await scheduleServer.createSchedule({
        agentId,
        name: form.name.trim(),
        task: form.task.trim(),
        cron,
        timezone: form.timezone,
        status: 'paused',
      });
      onSaved?.();
      enterTestView(saved);
      toaster?.showSuccess({
        title: 'Schedule saved as paused',
        description: formatCadenceSummary({ cron: saved.cron, timezone: saved.timezone }),
      });
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : 'Failed to save schedule';
      setError(message);
    } finally {
      setSaving(false);
    }
  };

  const handleActivate = async () => {
    if (view.kind !== 'test') return;
    setActivating(true);
    setError(null);
    try {
      await scheduleServer.updateSchedule({
        id: view.schedule.id,
        name: view.schedule.name,
        task: view.schedule.task,
        cron: view.schedule.cron,
        timezone: view.schedule.timezone,
        status: 'active',
      });
      onSaved?.();
      toaster?.showSuccess({ title: 'Schedule activated' });
      onOpenChange(false);
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : 'Failed to activate schedule';
      setError(message);
      toaster?.showError(caught);
    } finally {
      setActivating(false);
    }
  };

  const title =
    view.kind === 'test' ? 'Test Schedule' : isExternalEdit || isCreatedEdit ? 'Edit Schedule' : 'New Schedule';
  const description =
    view.kind === 'test'
      ? `Recurring unattended runs of ${agentLabel}.`
      : isExternalEdit || isCreatedEdit
        ? 'Update cadence and task for this schedule.'
        : 'Create a recurring unattended run for an agent.';

  let footer: ReactNode;
  if (view.kind === 'test') {
    footer = (
      <div className="flex flex-col gap-2">
        {error != null ? <p className="text-failure-bg text-sm">{error}</p> : null}
        <Button
          type="button"
          variant="secondary"
          className="w-full"
          disabled={activating}
          onClick={() => void handleActivate()}
        >
          Activate Anyway
        </Button>
      </div>
    );
  } else {
    footer = (
      <div className="flex flex-col gap-2">
        {error != null ? <p className="text-failure-bg text-sm">{error}</p> : null}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button type="submit" form="schedule-form" disabled={!canSubmit || saving}>
            Save
          </Button>
        </div>
      </div>
    );
  }

  return (
    <SideDrawer
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      description={description}
      anchor="right"
      size="lg"
      headerIcon={
        <span className="text-primary-button-bg inline-flex size-8 items-center justify-center">
          <Icon
            name={view.kind === 'test' || isExternalEdit || isCreatedEdit ? 'calendar' : 'calendar-plus'}
            className="size-5"
          />
        </span>
      }
      footer={footer}
    >
      {view.kind === 'test' ? (
        <TestScheduleScreen
          schedule={view.schedule}
          agentName={agentLabel}
          mcpMounts={mcpMounts}
          onEditConfiguration={() => {
            setError(null);
            setView({ kind: 'form', saved: view.schedule });
          }}
        />
      ) : (
        <form id="schedule-form" onSubmit={event => void handleSave(event)}>
          <ScheduleFormFields
            values={form}
            onChange={setForm}
            agentId={agentId}
            onAgentIdChange={isExternalEdit || isCreatedEdit ? undefined : setAgentId}
            agentOptions={agentOptions}
            agentPickerDisabled={isExternalEdit || isCreatedEdit}
          />
        </form>
      )}
    </SideDrawer>
  );
}

export function ScheduleFormDrawer(props: ScheduleFormDrawerProps) {
  return (
    <DraftCatalogProvider>
      <ScheduleFormDrawerBody {...props} />
    </DraftCatalogProvider>
  );
}
