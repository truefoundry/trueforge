import { describe, expect, it } from 'vitest';

import {
  AUTO_ROUTING_TIERS,
  coverageRangeLabel,
  tierCells,
  tierCoverageCounts,
  tierLabel,
  uncoveredTiers,
} from '@/containers/SettingsBuilder/autoRoutingTiers.js';

describe('autoRoutingTiers', () => {
  it('orders the tiers from simplest to most complex under the names the settings page shows', () => {
    expect(AUTO_ROUTING_TIERS.map(tierLabel)).toEqual(['Answer', 'Execute', 'Analyze', 'Frontier']);
  });

  describe('tierCells', () => {
    it('marks both ends of a covered stretch and joins the tiers between them', () => {
      expect(tierCells(['execute', 'analyze', 'frontier'])).toEqual([
        { category: 'answer', covered: false, isEnd: false, joinsNext: false },
        { category: 'execute', covered: true, isEnd: true, joinsNext: true },
        { category: 'analyze', covered: true, isEnd: false, joinsNext: true },
        { category: 'frontier', covered: true, isEnd: true, joinsNext: false },
      ]);
    });

    it('draws a lone tier as a single end', () => {
      expect(tierCells(['analyze']).map(cell => [cell.covered, cell.isEnd, cell.joinsNext])).toEqual([
        [false, false, false],
        [false, false, false],
        [true, true, false],
        [false, false, false],
      ]);
    });

    it('does not bridge a tier the model skips', () => {
      const cells = tierCells(['answer', 'analyze']);
      expect(cells.map(cell => cell.joinsNext)).toEqual([false, false, false, false]);
      expect(cells.filter(cell => cell.isEnd).map(cell => cell.category)).toEqual(['answer', 'analyze']);
    });

    it('covers nothing for an empty list', () => {
      expect(tierCells([]).some(cell => cell.covered)).toBe(false);
    });
  });

  describe('coverageRangeLabel', () => {
    it.each([
      [['answer'], 'Answer'],
      [['execute', 'analyze'], 'Execute – Analyze'],
      [['answer', 'execute', 'analyze', 'frontier'], 'Answer – Frontier'],
      [['analyze', 'frontier'], 'Analyze – Frontier'],
      [['answer', 'analyze'], 'Answer, Analyze'],
      [['answer', 'execute', 'frontier'], 'Answer – Execute, Frontier'],
      [[], ''],
    ] as const)('labels %j as %j', (categories, label) => {
      expect(coverageRangeLabel(categories)).toBe(label);
    });

    it('ignores the order the server lists the categories in', () => {
      expect(coverageRangeLabel(['analyze', 'execute'])).toBe('Execute – Analyze');
    });
  });

  describe('coverage counts', () => {
    it('counts the models serving each tier and names the tiers nobody serves', () => {
      const counts = tierCoverageCounts([['answer', 'execute'], ['execute', 'analyze'], ['execute']]);
      expect(counts).toEqual([1, 3, 1, 0]);
      expect(uncoveredTiers(counts)).toEqual(['frontier']);
    });

    it('reports every tier as uncovered when nothing is selected', () => {
      expect(tierCoverageCounts([])).toEqual([0, 0, 0, 0]);
      expect(uncoveredTiers([0, 0, 0, 0])).toEqual(['answer', 'execute', 'analyze', 'frontier']);
    });
  });
});
