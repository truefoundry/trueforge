import type {
  CreateSkillInput,
  GetSkillInput,
  ISkillStore,
  ListSkillsInput,
  SkillRecord,
  UpsertSkillInput,
} from '../db/skillStore';
import type { InlineSkills } from './inlineResources';

/**
 * Serves the skills a request brought with it, and delegates everything else.
 *
 * Mirrors {@link InlineMcpServerStore}: by-name lookup and name-filtered list are overlaid, an
 * unfiltered list passes through so request-scoped skills stay out of the tenant's settings, and
 * writes delegate because there is no row to write.
 */
export class InlineSkillStore<TTransaction = never> implements ISkillStore<TTransaction> {
  readonly #inner: ISkillStore<TTransaction>;
  readonly #inline: InlineSkills;

  constructor(input: { inner: ISkillStore<TTransaction>; inline: InlineSkills }) {
    this.#inner = input.inner;
    this.#inline = input.inline;
  }

  async getSkill(input: GetSkillInput, transaction?: TTransaction): Promise<SkillRecord | undefined> {
    const record = this.#toRecord(input.tenant_id, input.name);
    return record ?? (await this.#inner.getSkill(input, transaction));
  }

  async listSkills(input: ListSkillsInput, transaction?: TTransaction): Promise<SkillRecord[]> {
    if (input.names === undefined) {
      return this.#inner.listSkills(input, transaction);
    }

    const inlineRecords = input.names
      .map(name => this.#toRecord(input.tenant_id, name))
      .filter((record): record is SkillRecord => record !== undefined);
    const registryNames = input.names.filter(name => this.#inline[name] === undefined);
    const registryRecords =
      registryNames.length > 0 ? await this.#inner.listSkills({ ...input, names: registryNames }, transaction) : [];

    return [...inlineRecords, ...registryRecords];
  }

  createSkill(input: CreateSkillInput, transaction?: TTransaction): Promise<SkillRecord> {
    return this.#inner.createSkill(input, transaction);
  }

  upsertSkill(input: UpsertSkillInput, transaction?: TTransaction): Promise<SkillRecord> {
    return this.#inner.upsertSkill(input, transaction);
  }

  #toRecord(tenant_id: string, name: string): SkillRecord | undefined {
    const manifest = this.#inline[name];
    if (manifest === undefined) {
      return undefined;
    }
    const now = new Date().toISOString();
    return { tenant_id, name, manifest, created_at: now, updated_at: now };
  }
}
