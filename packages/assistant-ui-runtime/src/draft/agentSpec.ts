import type { AgentSpec } from '../server/types.js';

export interface DraftSession {
  title?: string | null;
  agentSpec: AgentSpec;
}

/** Partial update — host fields flow through when `TSpec` is widened. */
export type AgentSpecUpdate<TSpec extends AgentSpec = AgentSpec> = {
  [K in keyof TSpec]?: K extends 'model'
    ? Omit<Partial<TSpec['model']>, 'params'> & {
        params?: Partial<NonNullable<TSpec['model']['params']>>;
      }
    : TSpec[K];
};

export function mergeAgentSpec<TSpec extends AgentSpec>(base: TSpec, update: AgentSpecUpdate<TSpec>): TSpec {
  const { model: modelUpdate, ...rest } = update;

  const next: TSpec = Object.assign({}, base, rest);

  if (modelUpdate != null) {
    next.model = Object.assign({}, base.model, modelUpdate, {
      name: modelUpdate.name ?? base.model.name,
      params: modelUpdate.params != null ? { ...base.model.params, ...modelUpdate.params } : base.model.params,
    });
  }

  return next;
}

export function draftSessionTitle(draft: DraftSession): string {
  return draft.title ?? draft.agentSpec.model.name;
}
