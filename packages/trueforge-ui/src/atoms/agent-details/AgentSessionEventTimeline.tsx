'use client';

import { useCallback, useMemo, useState, type ComponentType } from 'react';

import { useSlot } from '../../theme/SlotsProvider.js';
import { SESSION_EVENT_TYPES, type SessionEventType } from '../../utils/sessionEventTimeline.js';
import { cn } from '../lib/cn.js';
import type { AgentSessionEventTimelineProps } from './types.js';

export function AgentSessionEventTimeline({ turns, segments, onSelectTurn }: AgentSessionEventTimelineProps) {
  const AgentSessionEventTimelineChart = useSlot('AgentSessionEventTimelineChart');
  const [hiddenTypes, setHiddenTypes] = useState<Set<SessionEventType>>(() => new Set());

  const availableEventTypes = useMemo(() => {
    const available = new Set(segments.map(segment => segment.type));
    return SESSION_EVENT_TYPES.filter(eventType => available.has(eventType.id));
  }, [segments]);

  const handleToggleType = useCallback((type: SessionEventType) => {
    setHiddenTypes(previous => {
      const next = new Set(previous);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return next;
    });
  }, []);

  if (segments.length === 0) return null;

  return (
    <div className="w-full" data-slot="agent-session-event-timeline">
      <div
        className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2"
        data-slot="agent-session-event-types"
      >
        <span className="text-xs font-medium uppercase text-text-secondary">Event types</span>
        <div className="flex flex-wrap items-center gap-1">
          {availableEventTypes.map(eventType => {
            const isVisible = !hiddenTypes.has(eventType.id);
            return (
              <button
                key={eventType.id}
                type="button"
                aria-pressed={isVisible}
                className={cn(
                  'flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium',
                  isVisible ? 'border-border text-text-primary' : 'border-transparent text-text-secondary opacity-80',
                )}
                onClick={() => handleToggleType(eventType.id)}
              >
                <span className="size-2 rounded-sm" style={{ backgroundColor: eventType.color }} />
                {eventType.label}
              </button>
            );
          })}
        </div>
      </div>
      <div className="w-full py-2">
        <AgentSessionEventTimelineChart
          turns={turns}
          segments={segments}
          hiddenTypes={hiddenTypes}
          onSelectTurn={onSelectTurn}
        />
      </div>
    </div>
  );
}

declare module '../../theme/SlotsProvider.js' {
  interface AtomSlots {
    AgentSessionEventTimeline: ComponentType<AgentSessionEventTimelineProps>;
  }
}
