/**
 * Public event-name contract for hosts (e.g. PostHog). Keep names stable — renaming is a breaking change.
 */
export const AnalyticsEvents = {
  Message: {
    SENT: 'trueforge.agent.message_sent',
    CANCELLED: 'trueforge.agent.message_cancelled',
    COPIED: 'trueforge.agent.message_copied',
    EDIT_STARTED: 'trueforge.agent.message_edit_started',
    RETRIED: 'trueforge.agent.message_retried',
  },
  Attachment: {
    PICKED: 'trueforge.agent.attachment_picked',
  },
  Session: {
    NEW: 'trueforge.agent.session_new',
    SELECTED: 'trueforge.agent.session_selected',
    DELETED: 'trueforge.agent.session_deleted',
    RENAMED: 'trueforge.agent.session_renamed',
    SHARE_OPENED: 'trueforge.agent.session_share_opened',
    SHARE_LINK_COPIED: 'trueforge.agent.session_share_link_copied',
  },
  Tool: {
    APPROVAL_RESOLVED: 'trueforge.agent.tool_approval_resolved',
  },
  AskUser: {
    SUBMITTED: 'trueforge.agent.ask_user_submitted',
  },
  Config: {
    OPENED: 'trueforge.agent.config_opened',
  },
  Settings: {
    OPENED: 'trueforge.agent.settings_opened',
    CLOSED: 'trueforge.settings.closed',
    SECTION_CHANGED: 'trueforge.settings.section_changed',
    MODEL_PROVIDER_SAVED: 'trueforge.settings.model_provider_saved',
    MODEL_PROVIDER_DELETED: 'trueforge.settings.model_provider_deleted',
    CONNECTOR_SAVED: 'trueforge.settings.connector_saved',
    CONNECTOR_DISCONNECTED: 'trueforge.settings.connector_disconnected',
    CONNECTOR_DELETED: 'trueforge.settings.connector_deleted',
    SKILL_IMPORTED: 'trueforge.settings.skill_imported',
    SKILL_DELETED: 'trueforge.settings.skill_deleted',
    SANDBOX_PROVIDER_SAVED: 'trueforge.settings.sandbox_provider_saved',
    SANDBOX_PROVIDER_DELETED: 'trueforge.settings.sandbox_provider_deleted',
    WEB_SEARCH_PROVIDER_SAVED: 'trueforge.settings.web_search_provider_saved',
  },
  Library: {
    OPENED: 'trueforge.library.opened',
    CLOSED: 'trueforge.library.closed',
    AGENT_TRIED: 'trueforge.library.agent_tried',
    AGENT_EDITED: 'trueforge.library.agent_edited',
    AGENT_DETAILS_OPENED: 'trueforge.library.agent_details_opened',
    AGENT_SCHEDULES_OPENED: 'trueforge.library.agent_schedules_opened',
  },
  AgentDetails: {
    OPENED: 'trueforge.agent_details.opened',
    TAB_CHANGED: 'trueforge.agent_details.tab_changed',
  },
  SessionsBrowser: {
    OPENED: 'trueforge.sessions_browser.opened',
  },
  Schedule: {
    PAGE_OPENED: 'trueforge.schedule.page_opened',
    CREATED: 'trueforge.schedule.created',
    EDITED: 'trueforge.schedule.edited',
    DELETED: 'trueforge.schedule.deleted',
    TOGGLED: 'trueforge.schedule.toggled',
    RUN_NOW: 'trueforge.schedule.run_now',
  },
  Environment: {
    PAGE_OPENED: 'trueforge.environment.page_opened',
    CREATED: 'trueforge.environment.created',
    EDITED: 'trueforge.environment.edited',
    DELETED: 'trueforge.environment.deleted',
  },
} as const;
