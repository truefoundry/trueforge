import type { defaultSlots } from './defaultSlots.js';

export type PublicAtomSlots = typeof defaultSlots;

export type SlotOverrides = Partial<PublicAtomSlots>;
