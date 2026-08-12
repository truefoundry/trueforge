import type React from 'react';

import { registerIcons } from './IconRegistry.js';

import Agent2Icon from './agent-2.svg';
import AiIcon from './ai.svg';
import BrainRegularIcon from './brain-regular.svg';
import CompareIcon from './compare.svg';
import McpServerIcon from './mcp-server.svg';
import SearchGlobeIcon from './search-globe.svg';
import TrueforgeLogomarkDarkIcon from './trueforge-logomark-dark.svg';
import TrueforgeLogomarkLightIcon from './trueforge-logomark-light.svg';

type SvgIcon = React.FC<React.SVGProps<SVGSVGElement>>;

registerIcons({
  'mcp-server': McpServerIcon as unknown as SvgIcon,
  'agent-2': Agent2Icon as unknown as SvgIcon,
  compare: CompareIcon as unknown as SvgIcon,
  ai: AiIcon as unknown as SvgIcon,
  searchGlobe: SearchGlobeIcon as unknown as SvgIcon,
  'brain-regular': BrainRegularIcon as unknown as SvgIcon,
  'trueforge-logomark-light': TrueforgeLogomarkLightIcon as unknown as SvgIcon,
  'trueforge-logomark-dark': TrueforgeLogomarkDarkIcon as unknown as SvgIcon,
});
