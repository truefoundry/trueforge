import type { AgentSpec, Model, ModelParams } from '../server/types.js';

export interface DraftSession {
  title?: string | null;
  agentSpec: AgentSpec;
}

type FixedModelOf<TModel extends Model> = Extract<TModel, { type: 'fixed' }>;

/**
 * A whole model replaces the current one. A fixed-model patch keeps the current name and merges `params` key by
 * key; naming a different model keeps the params too, and `undefined` clears one.
 */
export type ModelUpdate<TModel extends Model = Model> =
  | TModel
  | (Partial<Omit<FixedModelOf<TModel>, 'type' | 'params'>> & {
      type?: 'fixed';
      params?: Partial<NonNullable<FixedModelOf<TModel>['params']>>;
    });

/** Partial update — host fields flow through when `TSpec` is widened. */
export type AgentSpecUpdate<TSpec extends AgentSpec = AgentSpec> = {
  [K in keyof TSpec]?: K extends 'model' ? ModelUpdate<TSpec['model']> : TSpec[K];
};

/** The name of a fixed model; Auto has none. */
export function fixedModelName(model: Model): string | undefined {
  return model.type === 'fixed' ? model.name : undefined;
}

/** Call parameters on a fixed model; Auto has none. */
export function modelParams(model: Model): ModelParams | undefined {
  return model.type === 'fixed' ? model.params : undefined;
}

function mergeModel<TModel extends Model>(base: TModel, update: ModelUpdate<TModel>): TModel;
function mergeModel(base: Model, update: ModelUpdate): Model {
  if (update.type === 'auto') {
    return update;
  }
  const current = base.type === 'fixed' ? base : undefined;
  const name = update.name ?? current?.name;
  if (name === undefined) {
    return base;
  }
  const params = update.params != null ? { ...current?.params, ...update.params } : current?.params;
  return Object.assign({}, current, update, { type: 'fixed', name, params });
}

export function mergeAgentSpec<TSpec extends AgentSpec>(base: TSpec, update: AgentSpecUpdate<TSpec>): TSpec {
  const { model: modelUpdate, ...rest } = update;

  const next: TSpec = Object.assign({}, base, rest);

  if (modelUpdate != null) {
    next.model = mergeModel(base.model, modelUpdate);
  }

  return next;
}

export function draftSessionTitle(draft: DraftSession): string {
  return draft.title ?? fixedModelName(draft.agentSpec.model) ?? 'Auto';
}
