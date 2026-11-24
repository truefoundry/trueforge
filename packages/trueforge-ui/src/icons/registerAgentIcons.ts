/**
 * Kept as a side-effect entry for package `sideEffects` / hosts that import it
 * explicitly. Icons are also registered in `IconRegistry` defaults so lazy
 * layout chunks that duplicate the registry still resolve agent glyphs.
 */
import { registerIcons } from './IconRegistry.js';

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

registerIcons({
  'mcp-server': McpServerIcon,
  'agent-2': Agent2Icon,
  bot: Agent2Icon,
  robot: Agent2Icon,
  'message-ai-3-line': MessageAi3LineIcon,
  compare: CompareIcon,
  ai: AiIcon,
  searchGlobe: SearchGlobeIcon,
  'brain-regular': BrainRegularIcon,
  empty: EmptyIcon,
  'trueforge-logomark-light': TrueForgeLogomarkLightIcon,
  'trueforge-logomark-dark': TrueForgeLogomarkDarkIcon,
});
