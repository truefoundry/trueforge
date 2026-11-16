import type React from 'react';

import { registerIcons } from './IconRegistry.js';

import AiIcon from './ai.svg';
import BrainRegularIcon from './brain-regular.svg';
import CompareIcon from './compare.svg';
import EmptyIcon from './empty.svg';
import McpServerIcon from './mcp-server.svg';
import SearchGlobeIcon from './search-globe.svg';
import TrueForgeLogomarkDarkIcon from './trueforge-logomark-dark.svg';
import TrueForgeLogomarkLightIcon from './trueforge-logomark-light.svg';

type SvgIcon = React.FC<React.SVGProps<SVGSVGElement>>;

registerIcons({
  'mcp-server': McpServerIcon as unknown as SvgIcon,
  // agent-2 / bot / robot live in IconRegistry defaults so code-split chunks share them.
  compare: CompareIcon as unknown as SvgIcon,
  ai: AiIcon as unknown as SvgIcon,
  searchGlobe: SearchGlobeIcon as unknown as SvgIcon,
  'brain-regular': BrainRegularIcon as unknown as SvgIcon,
  empty: EmptyIcon as unknown as SvgIcon,
  'trueforge-logomark-light': TrueForgeLogomarkLightIcon as unknown as SvgIcon,
  'trueforge-logomark-dark': TrueForgeLogomarkDarkIcon as unknown as SvgIcon,
});
