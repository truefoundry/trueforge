import {
  Archive,
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  BookOpen,
  Bot,
  Box,
  Brain,
  Calendar,
  CalendarClock,
  CalendarPlus,
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
  Info,
  Lightbulb,
  LineChart,
  Link2,
  ListChecks,
  ListFilter,
  ListOrdered,
  Loader2,
  Lock,
  LogOut,
  Maximize2,
  Menu,
  MessageSquareText,
  Minimize2,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  Paperclip,
  Pause,
  Pencil,
  Play,
  Plug,
  Plus,
  RotateCw,
  Save,
  Search,
  Settings,
  Sparkle,
  SquarePen,
  Sun,
  Terminal,
  Trash2,
  TriangleAlert,
  Wrench,
  X,
} from 'lucide-react';
import type { SVGProps } from 'react';

import type { IconEntry, IconMap } from '../theme/types.js';

/** Lucide `broom` (https://lucide.dev/icons/broom) — not in lucide-react 0.x. */
function Broom({ size = 24, ...props }: SVGProps<SVGSVGElement> & { size?: string | number }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      <path d="M13.5 10.5 22 2" />
      <path d="M14.734 13.841a2 2 0 00-.314-2.42L12.58 9.58a2 2 0 00-2.421-.314l-7.657 4.461A1 1 0 002.3 15.3l6.403 6.403a1 1 0 001.571-.204z" />
      <path d="m5 18 2-2" />
      <path d="m7.699 10.7 5.602 5.601" />
    </svg>
  );
}

const registry = new Map<string, IconEntry>();

export function registerIcon(name: string, icon: IconEntry): void {
  registry.set(name, icon);
}

export function registerIcons(icons: IconMap): void {
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

const defaults: Record<string, IconEntry> = {
  paperclip: Paperclip,
  'arrow-up': ArrowUp,
  'arrow-down': ArrowDown,
  'arrow-left': ArrowLeft,
  xmark: X,
  check: Check,
  pencil: Pencil,
  play: Play,
  pause: Pause,
  calendar: Calendar,
  'calendar-clock': CalendarClock,
  'calendar-plus': CalendarPlus,
  'square-pen': SquarePen,
  'rotate-right': RotateCw,
  broom: Broom,
  ellipsis: Ellipsis,
  trash: Trash2,
  'box-archive': Archive,
  'clock-rotate-left': History,
  'circle-exclamation': CircleAlert,
  info: Info,
  'triangle-exclamation': TriangleAlert,
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
  'log-out': LogOut,
  search: Search,
  clock: Clock,
  'circle-check': CircleCheck,
  'circle-xmark': CircleX,
  'oauth-success': CircleCheck,
  'oauth-error': CircleX,
  'oauth-loading': Loader2,
  'welcome-sparkle': Sparkle,
  robot: Bot,
  bot: Bot,
  'message-square-text': MessageSquareText,
  'book-open': BookOpen,
  funnel: ListFilter,
  plug: Plug,
  'list-check': ListChecks,
  lock: Lock,
  lightbulb: Lightbulb,
  link: Link2,
  wrench: Wrench,
  cpu: Cpu,
  cube: Box,
  'list-ol': ListOrdered,
  download: Download,
  save: Save,
  brain: Brain,
  terminal: Terminal,
  code: Code2,
  chart: LineChart,
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
    return themeIcons[name];
  }
  return registry.get(name);
}
