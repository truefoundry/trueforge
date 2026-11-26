import Agent2Icon from './agent-2.svg';
import AiIcon from './ai.svg';
import BrainRegularIcon from './brain-regular.svg';
import CompareIcon from './compare.svg';
import EmptyIcon from './empty.svg';
import McpServerIcon from './mcp-server.svg';
import MessageAi3LineIcon from './message-ai-3-line.svg';
import SearchGlobeIcon from './search-globe.svg';
import TrueForgeLogomarkDarkIcon from './trueforge-logomark-dark.svg';
import TrueForgeLogomarkLightIcon from './trueforge-logomark-light.svg';

import {
  Archive,
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  BookOpen,
  BookText,
  Box,
  Brain,
  Calendar,
  CalendarClock,
  CalendarPlus,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronsUpDown,
  CircleAlert,
  CircleCheck,
  CircleExclamationPoint,
  CircleX,
  Clock,
  Clock7,
  Code2,
  Copy,
  Cpu,
  DollarSign,
  Download,
  Ellipsis,
  EllipsisVertical,
  ExternalLink,
  File,
  FileCode2,
  FileSpreadsheet,
  FileText,
  GripVertical,
  History,
  Info,
  Layers,
  Layers2,
  LibraryBig,
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
  Monitor,
  Moon,
  PanelLeft,
  PanelLeftClose,
  PanelLeftOpen,
  Paperclip,
  Pause,
  Pencil,
  Play,
  Plug,
  Plus,
  RefreshCw,
  RotateCw,
  Save,
  ScrollText,
  Search,
  Settings,
  Share,
  Shield,
  ShieldCheck,
  SlidersHorizontal,
  Sparkle,
  SquareArrowOutUpRight,
  SquarePen,
  Sun,
  Tag,
  Terminal,
  Trash2,
  TriangleAlert,
  Type,
  UserCog,
  Users,
  Wand,
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

/** GitHub mark — lucide-react 1.x dropped brand icons (incl. `Github`). */
function GitHub({ size = 24, ...props }: SVGProps<SVGSVGElement> & { size?: string | number }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      {...props}
    >
      <path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12" />
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
  'grip-vertical': GripVertical,
  'square-pen': SquarePen,
  'rotate-right': RotateCw,
  'refresh-cw': RefreshCw,
  broom: Broom,
  ellipsis: Ellipsis,
  'ellipsis-vertical': EllipsisVertical,
  trash: Trash2,
  'box-archive': Archive,
  'clock-rotate-left': History,
  'circle-exclamation': CircleAlert,
  info: Info,
  'circle-exclamation-point': CircleExclamationPoint,
  'triangle-exclamation': TriangleAlert,
  'chevron-down': ChevronDown,
  'chevron-left': ChevronLeft,
  'chevron-right': ChevronRight,
  'chevrons-up-down': ChevronsUpDown,
  loader: Loader2,
  file: File,
  'file-code': FileCode2,
  'file-spreadsheet': FileSpreadsheet,
  'file-text': FileText,
  clone: Copy,
  copy: Copy,
  'dollar-sign': DollarSign,
  bars: Menu,
  'panel-left': PanelLeft,
  'panel-left-close': PanelLeftClose,
  'panel-left-open': PanelLeftOpen,
  plus: Plus,
  sun: Sun,
  moon: Moon,
  type: Type,
  settings: Settings,
  share: Share,
  shield: Shield,
  'shield-check': ShieldCheck,
  sliders: SlidersHorizontal,
  'log-out': LogOut,
  search: Search,
  clock: Clock,
  'circle-check': CircleCheck,
  'circle-xmark': CircleX,
  'oauth-success': CircleCheck,
  'oauth-error': CircleX,
  'oauth-loading': Loader2,
  'welcome-sparkle': Sparkle,
  // Custom agent SVGs live in defaults so every bundled IconRegistry copy has them
  // (lazy layout chunks do not re-run the index.ts registerAgentIcons side effect).
  'agent-2': Agent2Icon,
  robot: Agent2Icon,
  bot: Agent2Icon,
  'message-ai-3-line': MessageAi3LineIcon,
  'mcp-server': McpServerIcon,
  compare: CompareIcon,
  ai: AiIcon,
  searchGlobe: SearchGlobeIcon,
  'brain-regular': BrainRegularIcon,
  empty: EmptyIcon,
  'trueforge-logomark-light': TrueForgeLogomarkLightIcon,
  'trueforge-logomark-dark': TrueForgeLogomarkDarkIcon,
  layers: Layers,
  'library-big': LibraryBig,
  'book-text': BookText,
  'clock-7': Clock7,
  'layers-2': Layers2,
  'message-square-text': MessageSquareText,
  'book-open': BookOpen,
  funnel: ListFilter,
  plug: Plug,
  'list-check': ListChecks,
  lock: Lock,
  'user-cog': UserCog,
  users: Users,
  lightbulb: Lightbulb,
  wand: Wand,
  // Skills (settings, composer attach, agent config / overview).
  'scroll-text': ScrollText,

  tag: Tag,
  link: Link2,
  wrench: Wrench,
  wand: Wand,
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
  'square-arrow-out-up-right': SquareArrowOutUpRight,
  github: GitHub,
  monitor: Monitor,
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
