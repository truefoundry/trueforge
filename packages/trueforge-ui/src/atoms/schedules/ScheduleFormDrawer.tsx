'use client';

import { useEffect, useMemo, useState, type FormEvent } from 'react';

import { Icon } from '../../icons/Icon.js';
import { useScheduleServer, useServer } from '../../server/ServerContext.js';
import { libraryAgentId } from '../../server/ShellModeContext.js';
import type { Schedule } from '../../server/types.js';
import { SEARCH_AGENTS_PAGE_SIZE } from '../lib/useSearchAgentsList.js';
import { Button } from '../primitives/Button.js';
import { SideDrawer } from '../primitives/SideDrawer.js';
import { cronToFormValues, defaultScheduleFormValues, valuesToCron, type ScheduleFormValues } from './cadence.js';
import { ScheduleFormFields } from './ScheduleFormFields.js';

export type ScheduleFormDrawerProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: 'create' | 'edit';
  schedule?: Schedule;
  initialAgentId?: string;
  onSaved?: () => void;
};

export function ScheduleFormDrawer({
  open,
  onOpenChange,
  mode,
  schedule,
  initialAgentId = '',
  onSaved,
}: ScheduleFormDrawerProps) {
  const scheduleServer = useScheduleServer();
  const server = useServer();
  const [form, setForm] = useState<ScheduleFormValues>(defaultScheduleFormValues);
  const [agentId, setAgentId] = useState(initialAgentId);
  const [agentOptions, setAgentOptions] = useState<Array<{ agentId: string; name: string }>>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isEdit = mode === 'edit';

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void server
      .searchAgents({ limit: SEARCH_AGENTS_PAGE_SIZE })
      .then(rows => {
        if (cancelled) return;
        setAgentOptions(rows.map(agent => ({ agentId: libraryAgentId(agent), name: agent.name })));
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
      return;
    }
    if (isEdit && schedule != null) {
      setForm(
        cronToFormValues({
          name: schedule.name,
          task: schedule.task,
          cron: schedule.cron,
          timezone: schedule.timezone,
        }),
      );
      setAgentId(schedule.agentId);
      return;
    }
    setForm(defaultScheduleFormValues());
    setAgentId(initialAgentId);
  }, [open, isEdit, schedule, initialAgentId]);

  const title = isEdit ? 'Edit Schedule' : 'New Schedule';
  const description = isEdit
    ? 'Update cadence and task for this schedule.'
    : 'Create a recurring unattended run for an agent.';

  const canSubmit = useMemo(() => {
    const cron = valuesToCron(form);
    return form.name.trim().length > 0 && form.task.trim().length > 0 && cron.length > 0 && agentId.length > 0;
  }, [form, agentId]);

  const handleSave = async (event: FormEvent) => {
    event.preventDefault();
    if (!canSubmit) return;
    const cron = valuesToCron(form);
    setSaving(true);
    setError(null);
    try {
      if (isEdit && schedule != null) {
        await scheduleServer.updateSchedule({
          id: schedule.id,
          name: form.name.trim(),
          task: form.task.trim(),
          cron,
          timezone: form.timezone,
          status: schedule.status,
        });
      } else {
        await scheduleServer.createSchedule({
          agentId,
          name: form.name.trim(),
          task: form.task.trim(),
          cron,
          timezone: form.timezone,
        });
      }
      onSaved?.();
      onOpenChange(false);
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : 'Failed to save schedule';
      setError(message);
    } finally {
      setSaving(false);
    }
  };

  const footer = (
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

  return (
    <SideDrawer
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      description={description}
      anchor="right"
      size="md"
      headerIcon={
        <span className="text-primary-button-bg inline-flex size-8 items-center justify-center">
          <Icon name={isEdit ? 'calendar' : 'calendar-plus'} className="size-5" />
        </span>
      }
      footer={footer}
    >
      <form id="schedule-form" onSubmit={handleSave}>
        <ScheduleFormFields
          values={form}
          onChange={setForm}
          agentId={agentId}
          onAgentIdChange={isEdit ? undefined : setAgentId}
          agentOptions={agentOptions}
          agentPickerDisabled={isEdit}
        />
      </form>
    </SideDrawer>
  );
}
