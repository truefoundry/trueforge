import type { Artifact } from '@truefoundry/trueforge-ui';

const HOUR_MS = 60 * 60 * 1000;

export const DUMMY_CURRENT_SUBJECT_ID = 'dummy-user';
const SUBJECT = { subjectId: DUMMY_CURRENT_SUBJECT_ID, subjectType: 'user', subjectDisplayName: 'Demo User' } as const;
const OTHER_SUBJECT = { subjectId: 'dummy-priya', subjectType: 'user', subjectDisplayName: 'Priya Shah' } as const;

const ROWS: readonly {
  slug: string;
  title: string;
  latestVersion: number;
  entryPoint: string | null;
  ageHours: number;
}[] = [
  { slug: 'space-channel-plan', title: 'Space channel plan', latestVersion: 3, entryPoint: 'index.html', ageHours: 2 },
  { slug: 'agents-inventory', title: 'Agents inventory', latestVersion: 1, entryPoint: 'report.md', ageHours: 5 },
  { slug: 'schedules-report', title: 'Schedules report', latestVersion: 2, entryPoint: 'report.md', ageHours: 9 },
  { slug: 'q4-gtm-brief', title: 'Q4 GTM brief', latestVersion: 4, entryPoint: 'index.html', ageHours: 27 },
  { slug: 'pricing-calculator', title: 'Pricing calculator', latestVersion: 2, entryPoint: 'index.html', ageHours: 30 },
  {
    slug: 'usage-dashboard',
    title: 'Usage dashboard',
    latestVersion: 1,
    entryPoint: 'dashboard/index.html',
    ageHours: 52,
  },
  {
    slug: 'onboarding-checklist',
    title: 'Onboarding checklist',
    latestVersion: 1,
    entryPoint: 'report.md',
    ageHours: 75,
  },
  {
    slug: 'incident-postmortem',
    title: 'Incident postmortem',
    latestVersion: 3,
    entryPoint: 'report.md',
    ageHours: 98,
  },
  { slug: 'eval-results', title: 'Eval results', latestVersion: 2, entryPoint: 'index.html', ageHours: 120 },
  { slug: 'roadmap-timeline', title: 'Roadmap timeline', latestVersion: 4, entryPoint: 'index.html', ageHours: 160 },
  {
    slug: 'cost-breakdown',
    title: 'Cost breakdown',
    latestVersion: 1,
    entryPoint: 'dashboard/index.html',
    ageHours: 210,
  },
  { slug: 'empty-draft', title: 'Empty draft', latestVersion: 1, entryPoint: null, ageHours: 300 },
];

export function buildDummyArtifacts({ nowMs = Date.now() }: { nowMs?: number } = {}): Artifact[] {
  return ROWS.map(({ ageHours, ...row }, index) => {
    const updatedAt = new Date(nowMs - ageHours * HOUR_MS).toISOString();
    return {
      id: `art${String(index + 1).padStart(3, '0')}`,
      ...row,
      createdBySubject: index % 3 === 2 ? OTHER_SUBJECT : SUBJECT,
      createdBySessionId: `dummy-session-${row.slug}`,
      createdAt: new Date(nowMs - (ageHours + 24) * HOUR_MS).toISOString(),
      updatedAt,
    };
  });
}
