import type { LucideIcon } from 'lucide-react';
import {
  Archive,
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  Bot,
  Box,
  Brain,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  CircleCheck,
  CircleX,
  Clock,
  Code2,
  Copy,
  Cpu,
  Download,
  Ellipsis,
  ExternalLink,
  File,
  Github,
  History,
  Lightbulb,
  ListChecks,
  ListOrdered,
  Loader2,
  Maximize2,
  Menu,
  Minimize2,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  Paperclip,
  Pencil,
  Plug,
  Plus,
  RotateCw,
  Search,
  Settings,
  Sun,
  Terminal,
  Trash2,
  Wrench,
  X,
} from 'lucide-react';
import type { FC, ReactNode, SVGProps } from 'react';

import type { IconMap, IconProps } from '../theme/types.js';

export type IconEntry = LucideIcon | ReactNode | ((props: IconProps) => ReactNode) | FC<SVGProps<SVGSVGElement>>;

const registry = new Map<string, IconEntry>();

export function registerIcon(name: string, icon: IconEntry): void {
  registry.set(name, icon);
}

export function registerIcons(icons: Record<string, IconEntry>): void {
  for (const [name, icon] of Object.entries(icons)) {
    registry.set(name, icon);
  }
}

export function getIcon(name: string): IconEntry | undefined {
  return registry.get(name);
}

export function resolveIconName(icon: string | readonly string[]): string {
  if (typeof icon === 'string') return icon;
  // e.g. ["far", "clone"] → "clone"
  return icon[icon.length - 1] ?? '';
}

const defaults: Record<string, LucideIcon> = {
  paperclip: Paperclip,
  'arrow-up': ArrowUp,
  'arrow-down': ArrowDown,
  'arrow-left': ArrowLeft,
  xmark: X,
  check: Check,
  pencil: Pencil,
  'rotate-right': RotateCw,
  ellipsis: Ellipsis,
  trash: Trash2,
  'box-archive': Archive,
  'clock-rotate-left': History,
  'circle-exclamation': CircleAlert,
  'chevron-down': ChevronDown,
  'chevron-left': ChevronLeft,
  'chevron-right': ChevronRight,
  loader: Loader2,
  file: File,
  clone: Copy,
  copy: Copy,
  bars: Menu,
  'panel-left-close': PanelLeftClose,
  'panel-left-open': PanelLeftOpen,
  plus: Plus,
  sun: Sun,
  moon: Moon,
  settings: Settings,
  search: Search,
  clock: Clock,
  'circle-check': CircleCheck,
  'circle-xmark': CircleX,
  robot: Bot,
  plug: Plug,
  'list-check': ListChecks,
  lightbulb: Lightbulb,
  wrench: Wrench,
  cpu: Cpu,
  cube: Box,
  'list-ol': ListOrdered,
  download: Download,
  brain: Brain,
  terminal: Terminal,
  code: Code2,
  expand: Maximize2,
  'expand-alt': Maximize2,
  compress: Minimize2,
  'external-link': ExternalLink,
  github: Github,
};

for (const [name, icon] of Object.entries(defaults)) {
  registry.set(name, icon);
}

/** Merge host `theme.icons` over the registry for a single lookup (does not mutate). */
export function lookupIcon(name: string, themeIcons?: IconMap): IconEntry | undefined {
  if (themeIcons && name in themeIcons) {
    return themeIcons[name] as IconEntry;
  }
  return registry.get(name);
}
