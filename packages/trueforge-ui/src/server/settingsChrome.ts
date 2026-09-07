/**
 * @deprecated Import chrome gates from `./serverChrome.js`.
 * Kept so existing relative imports keep working.
 */
export {
  isMetricsChromeEnabled,
  isSchedulesChromeEnabled,
  isSessionsChromeEnabled,
  isSettingsChromeEnabled,
  toEffectiveRoutes,
} from './serverChrome.js';
