'use client';

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';

import { Button } from '@/atoms/primitives/Button.js';
import SearchInput from '@/atoms/primitives/SearchInput.js';
import { Icon } from '@/icons/Icon.js';
import { useCatalogServer } from '../../server/ServerContext.js';
import type { RegistrySkill, SkillBase, SkillCatalogEntry, SkillConfigBase } from '../../server/types.js';
import ImportGithubSkillForm from './ImportGithubSkillForm.js';

const matchesQuery = (query: string, name: string, description: string) =>
  !query || name.toLowerCase().includes(query) || description.toLowerCase().includes(query);

const isRegistrySkill = (skill: SkillBase): skill is RegistrySkill => 'catalogId' in skill;

const SkillSettings = () => {
  const { skillCatalog } = useCatalogServer();

  const [query, setQuery] = useState('');
  const [skills, setSkills] = useState<SkillBase[]>([]);
  const [catalog, setCatalog] = useState<SkillCatalogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [importOpen, setImportOpen] = useState(false);

  const refresh = useCallback(async () => {
    if (!skillCatalog) return;
    setLoading(true);
    setError(null);
    try {
      const [defined, available] = await Promise.all([skillCatalog.listSkills(), skillCatalog.getSkillCatalog()]);
      setSkills(defined);
      setCatalog(available);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load skills');
    } finally {
      setLoading(false);
    }
  }, [skillCatalog]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const normalizedQuery = query.trim().toLowerCase();

  const selectedSkills = useMemo(
    () => skills.filter(skill => matchesQuery(normalizedQuery, skill.name, skill.description)),
    [skills, normalizedQuery],
  );

  const availableSkills = useMemo(() => {
    const selectedCatalogIds = new Set(skills.flatMap(skill => (isRegistrySkill(skill) ? [skill.catalogId] : [])));
    return catalog.filter(
      entry => !selectedCatalogIds.has(entry.id) && matchesQuery(normalizedQuery, entry.name, entry.description),
    );
  }, [catalog, skills, normalizedQuery]);

  const runMutation = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Request failed');
      throw err;
    } finally {
      setBusy(false);
    }
  };

  if (!skillCatalog) {
    return <p className="text-sm text-muted-foreground">Skills catalog is not available.</p>;
  }

  const handleSelect = (entry: SkillCatalogEntry) => {
    void runMutation(async () => {
      await skillCatalog.createSkill({
        catalogId: entry.id,
        name: entry.name,
        description: entry.description,
        repoURL: entry.repoURL,
        path: entry.path,
        ref: entry.ref,
      });
    }).catch(() => {});
  };

  const handleRemove = (skill: SkillBase) => {
    const deleteSkill = skillCatalog.deleteSkill;
    if (!deleteSkill) return;
    void runMutation(async () => {
      await deleteSkill({ id: skill.id });
    }).catch(() => {});
  };

  const handleImport = async (draft: SkillConfigBase) => {
    await runMutation(async () => {
      await skillCatalog.createSkill(draft);
    });
  };

  const renderRow = ({
    key,
    name,
    description,
    source,
    action,
  }: {
    key: string;
    name: string;
    description: string;
    source: 'registry' | 'github';
    action: ReactNode;
  }) => (
    <article key={key} className="flex min-h-16 items-center gap-3 border-b border-border p-3 last:border-b-0">
      <span
        className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-border bg-muted"
        aria-hidden
      >
        <Icon name="lightbulb" className="size-4.5 text-foreground" />
      </span>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <h5 className="truncate text-sm font-medium text-foreground">{name}</h5>
          <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-border bg-muted/40 px-2 py-0.5 text-xs font-medium text-muted-foreground">
            {source === 'github' ? (
              <>
                <Icon name="github" className="size-3" />
                GitHub
              </>
            ) : (
              'Registry'
            )}
          </span>
        </div>
        {description ? <p className="mt-0.5 truncate text-sm text-muted-foreground">{description}</p> : null}
      </div>

      {action}
    </article>
  );

  const hasMatches = selectedSkills.length > 0 || availableSkills.length > 0;

  return (
    <>
      <h3 className="text-xl font-semibold tracking-tight text-foreground">Skills</h3>
      <p className="mt-1 text-sm text-muted-foreground">Use built-in skills or import custom skills from GitHub.</p>

      {error ? (
        <p className="mt-3 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      ) : null}

      <div className="mt-4 flex min-h-0 flex-1 flex-col gap-3">
        <div className="flex flex-col gap-2 sm:flex-row">
          <div className="min-w-0 flex-1">
            <SearchInput query={query} setQuery={setQuery} placeholder="Search skills" />
          </div>
          <Button
            variant="secondary"
            type="button"
            className="shrink-0"
            disabled={busy}
            onClick={() => {
              setImportOpen(true);
            }}
          >
            <Icon name="github" className="size-4" />
            Import from GitHub
          </Button>
        </div>

        <div className="flex flex-1 flex-col gap-5 overflow-y-auto pb-1">
          {loading ? <p className="py-8 text-center text-sm text-muted-foreground">Loading…</p> : null}

          {!loading && selectedSkills.length > 0 ? (
            <section aria-labelledby="selected-skills-heading">
              <h4
                id="selected-skills-heading"
                className="mb-2 text-[0.8125rem] font-semibold uppercase text-muted-foreground"
              >
                Selected · {selectedSkills.length}
              </h4>
              <div className="overflow-hidden rounded-xl border border-border bg-card">
                {selectedSkills.map(skill =>
                  renderRow({
                    key: skill.id,
                    name: skill.name,
                    description: skill.description,
                    source: isRegistrySkill(skill) ? 'registry' : 'github',
                    action: skillCatalog.deleteSkill ? (
                      <Button
                        variant="outline"
                        size="sm"
                        type="button"
                        disabled={busy}
                        aria-label={`Remove ${skill.name}`}
                        onClick={() => {
                          handleRemove(skill);
                        }}
                      >
                        Remove
                      </Button>
                    ) : null,
                  }),
                )}
              </div>
            </section>
          ) : null}

          {!loading && availableSkills.length > 0 ? (
            <section aria-labelledby="available-skills-heading">
              <h4
                id="available-skills-heading"
                className="mb-2 text-[0.8125rem] font-semibold uppercase text-muted-foreground"
              >
                Available · {availableSkills.length}
              </h4>
              <div className="overflow-hidden rounded-xl border border-border bg-card">
                {availableSkills.map(entry =>
                  renderRow({
                    key: entry.id,
                    name: entry.name,
                    description: entry.description,
                    source: 'registry',
                    action: (
                      <Button
                        variant="outline"
                        size="sm"
                        type="button"
                        disabled={busy}
                        aria-label={`Select ${entry.name}`}
                        onClick={() => {
                          handleSelect(entry);
                        }}
                      >
                        Select
                      </Button>
                    ),
                  }),
                )}
              </div>
            </section>
          ) : null}

          {!loading && !hasMatches ? (
            <div className="flex flex-1 items-center justify-center rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
              {normalizedQuery ? `No skills match “${query.trim()}”.` : 'No skills yet.'}
            </div>
          ) : null}
        </div>
      </div>

      <ImportGithubSkillForm open={importOpen} onOpenChange={setImportOpen} onImport={handleImport} busy={busy} />
    </>
  );
};

export default SkillSettings;
