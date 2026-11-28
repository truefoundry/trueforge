import { TrueForgeApi } from '@truefoundry/trueforge-sdk';

import type { AutoRoutingCategory } from '../../server/types.js';

/** The SDK enum lists categories simplest first; the picker draws its columns in that order. */
export const AUTO_ROUTING_TIERS: readonly AutoRoutingCategory[] = Object.values(TrueForgeApi.AutoRoutingCategory);

/** The platform defines no separate display name, so the category value is the name. */
export function tierLabel(category: AutoRoutingCategory): string {
  return category.charAt(0).toUpperCase() + category.slice(1);
}

export type TierCell = {
  category: AutoRoutingCategory;
  covered: boolean;
  /** First or last tier of a covered stretch; a lone tier is both. */
  isEnd: boolean;
  /** The covered stretch continues into the next tier. */
  joinsNext: boolean;
};

/** One cell per tier. Covered tiers are normally one stretch, but a gap in the list is drawn as a gap. */
export function tierCells(categories: readonly AutoRoutingCategory[]): TierCell[] {
  const covered = AUTO_ROUTING_TIERS.map(tier => categories.includes(tier));
  return AUTO_ROUTING_TIERS.map((category, index) => {
    const isCovered = covered[index] === true;
    const previous = index > 0 && covered[index - 1] === true;
    const next = covered[index + 1] === true;
    return { category, covered: isCovered, isEnd: isCovered && !(previous && next), joinsNext: isCovered && next };
  });
}

/** How many of the given models serve each tier, in tier order. */
export function tierCoverageCounts(models: readonly (readonly AutoRoutingCategory[])[]): number[] {
  return AUTO_ROUTING_TIERS.map(tier => models.filter(categories => categories.includes(tier)).length);
}

/** The tiers no model serves, in tier order. */
export function uncoveredTiers(counts: readonly number[]): AutoRoutingCategory[] {
  return AUTO_ROUTING_TIERS.filter((_, index) => counts[index] === 0);
}
