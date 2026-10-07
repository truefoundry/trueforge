/**
 * Public event-name contract for hosts (e.g. PostHog). Keep names stable — renaming is a breaking change.
 */
export const AnalyticsEvents = {
  Message: {
    SENT: 'agent.message_sent',
    CANCELLED: 'agent.message_cancelled',
    COPIED: 'agent.message_copied',
    EDIT_STARTED: 'agent.message_edit_started',
    RETRIED: 'agent.message_retried',
  },
  Attachment: {
    PICKED: 'agent.attachment_picked',
  },
  Session: {
    NEW: 'agent.session_new',
    SELECTED: 'agent.session_selected',
    DELETED: 'agent.session_deleted',
    RENAMED: 'agent.session_renamed',
    SHARE_OPENED: 'agent.session_share_opened',
    SHARE_LINK_COPIED: 'agent.session_share_link_copied',
  },
  Tool: {
    APPROVAL_RESOLVED: 'agent.tool_approval_resolved',
  },
  AskUser: {
    SUBMITTED: 'agent.ask_user_submitted',
  },
  Config: {
    OPENED: 'agent.config_opened',
  },
  Settings: {
    OPENED: 'agent.settings_opened',
    CLOSED: 'settings.closed',
    SECTION_CHANGED: 'settings.section_changed',
    MODEL_PROVIDER_SAVED: 'settings.model_provider_saved',
    MODEL_PROVIDER_DELETED: 'settings.model_provider_deleted',
    CONNECTOR_SAVED: 'settings.connector_saved',
    CONNECTOR_DISCONNECTED: 'settings.connector_disconnected',
    CONNECTOR_DELETED: 'settings.connector_deleted',
    SKILL_IMPORTED: 'settings.skill_imported',
    SKILL_DELETED: 'settings.skill_deleted',
    SANDBOX_PROVIDER_SAVED: 'settings.sandbox_provider_saved',
    SANDBOX_PROVIDER_DELETED: 'settings.sandbox_provider_deleted',
    WEB_SEARCH_PROVIDER_SAVED: 'settings.web_search_provider_saved',
  },
  Library: {
    OPENED: 'library.opened',
    CLOSED: 'library.closed',
    AGENT_TRIED: 'library.agent_tried',
    AGENT_EDITED: 'library.agent_edited',
    AGENT_DETAILS_OPENED: 'library.agent_details_opened',
    AGENT_SCHEDULES_OPENED: 'library.agent_schedules_opened',
  },
  AgentDetails: {
    OPENED: 'agent_details.opened',
    TAB_CHANGED: 'agent_details.tab_changed',
  },
  SessionsBrowser: {
    OPENED: 'sessions_browser.opened',
  },
  Schedule: {
    PAGE_OPENED: 'schedule.page_opened',
    CREATED: 'schedule.created',
    EDITED: 'schedule.edited',
    DELETED: 'schedule.deleted',
    TOGGLED: 'schedule.toggled',
    RUN_NOW: 'schedule.run_now',
  },
  Environment: {
    PAGE_OPENED: 'environment.page_opened',
    CREATED: 'environment.created',
    EDITED: 'environment.edited',
    DELETED: 'environment.deleted',
  },
} as const;
