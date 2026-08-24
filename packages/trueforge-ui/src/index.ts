'use client';

import './icons/registerAgentIcons.js';

export { BrandLogo, useBrandName } from './theme/brand.js';
export { defaultSlots } from './theme/defaultSlots.js';
export { PRESETS, resolvePresetTokens } from './theme/presets/index.js';
export type { PublicAtomSlots as AtomSlots, SlotOverrides } from './theme/publicSlots.js';
export { SlotsProvider, useSlot, useThemeMode } from './theme/SlotsProvider.js';
export type { ThemeMode } from './theme/SlotsProvider.js';
export {
  ThemeProvider,
  useBrand,
  useContentClassNames,
  useOptionalContentClassNames,
  useThemeIcons,
} from './theme/ThemeProvider.js';
export type {
  BrandConfig,
  BrandLogoConfig,
  ContentClassNames,
  IconMap,
  LayoutProp,
  SemanticTokens,
  ThemeConfig,
  IconProps as ThemeIconProps,
  ThemePreset,
} from './theme/types.js';

export { BottomSheet } from './atoms/primitives/BottomSheet.js';
export type { BottomSheetProps } from './atoms/primitives/BottomSheet.js';
export type { ButtonProps, ButtonSize, ButtonVariant } from './atoms/primitives/Button.js';
export { CenteredModal } from './atoms/primitives/CenteredModal.js';
export type { CenteredModalProps } from './atoms/primitives/CenteredModal.js';
export type { IconButtonProps } from './atoms/primitives/IconButton.js';
export { Switch } from './atoms/primitives/Switch.js';
export type { SwitchProps, SwitchSize } from './atoms/primitives/Switch.js';
export { Icon } from './icons/Icon.js';
export type { IconProps } from './icons/Icon.js';

export { Avatar, AvatarFallback, AvatarImage } from './atoms/primitives/Avatar.js';
export type { AvatarFallbackProps, AvatarImageProps, AvatarProps } from './atoms/primitives/Avatar.js';

export { AssistantMessageBubble } from './atoms/AssistantMessageBubble.js';
export type { AssistantMessageBubbleProps } from './atoms/AssistantMessageBubble.js';
export { ChatFileDownload } from './atoms/ChatFileDownload.js';
export type { ChatFileDownloadFile, ChatFileDownloadProps } from './atoms/ChatFileDownload.js';
export { CodeEditor } from './atoms/CodeEditor.js';
export type { CodeEditorProps } from './atoms/CodeEditor.js';
export { HistoryLoader } from './atoms/HistoryLoader.js';
export type { HistoryLoaderProps } from './atoms/HistoryLoader.js';
export { Markdown, preloadMarkdownOpenUI } from './atoms/Markdown.js';
export type { MarkdownProps } from './atoms/Markdown.js';
export { MessageActionBar } from './atoms/MessageActionBar.js';
export type { MessageActionBarProps } from './atoms/MessageActionBar.js';
export { MessageErrorBanner } from './atoms/MessageErrorBanner.js';
export type { MessageErrorBannerProps } from './atoms/MessageErrorBanner.js';
export { MessageIndicator } from './atoms/MessageIndicator.js';
export type { MessageIndicatorProps } from './atoms/MessageIndicator.js';
export { MessageTimestamp } from './atoms/MessageTimestamp.js';
export type { MessageTimestampProps } from './atoms/MessageTimestamp.js';
export { MonacoEditorCore } from './atoms/MonacoEditorCore.js';
export type { MonacoEditorCoreProps } from './atoms/MonacoEditorCore.js';
export { OpenUiFenceBlock } from './atoms/OpenUiFenceBlock.js';
export type { OpenUiFenceBlockProps } from './atoms/OpenUiFenceBlock.js';
export { SandboxArtifactDownload } from './atoms/SandboxArtifactDownload.js';
export type { SandboxArtifactDownloadProps } from './atoms/SandboxArtifactDownload.js';
export { ScrollToBottomButton } from './atoms/ScrollToBottomButton.js';
export type { ScrollToBottomButtonProps } from './atoms/ScrollToBottomButton.js';
export { MessageListSkeleton } from './atoms/Skeletons.js';
export type { MessageListSkeletonProps } from './atoms/Skeletons.js';
export { SyntaxHighlighter } from './atoms/SyntaxHighlighter.js';
export type { SyntaxHighlighterProps } from './atoms/SyntaxHighlighter.js';
export { MessageGroup, ThreadComposerAreaShell, ThreadRootShell, ThreadViewportShell } from './atoms/ThreadShell.js';
export type {
  MessageGroupProps,
  ThreadComposerAreaShellProps,
  ThreadRootShellProps,
  ThreadViewportShellProps,
} from './atoms/ThreadShell.js';
export { UserMessageActionBar } from './atoms/UserMessageActionBar.js';
export type { UserMessageActionBarProps } from './atoms/UserMessageActionBar.js';
export { UserMessageBubble } from './atoms/UserMessageBubble.js';
export type { UserMessageBubbleProps } from './atoms/UserMessageBubble.js';
export { UserMessageEdit } from './atoms/UserMessageEdit.js';
export type { UserMessageEditProps } from './atoms/UserMessageEdit.js';
export { WelcomeScreen } from './atoms/WelcomeScreen.js';
export type { WelcomeScreenProps } from './atoms/WelcomeScreen.js';

export { AgentStepsCard } from './atoms/adapters/AgentStepsCardAdapter.js';
export type { AgentStepsCardProps } from './atoms/adapters/AgentStepsCardAdapter.js';
export type {
  AskUserAnswerDraft,
  AnsweredQuestion as AskUserAnsweredQuestion,
  AskUserPromptProps,
  Question as AskUserQuestion,
  AskUserPromptProps as AskUserQuestionCardProps,
} from './atoms/adapters/AskUserPromptAdapter.js';
export type {
  McpAuthPromptProps as McpAuthCardProps,
  McpAuthPromptProps,
  McpServer as McpAuthServer,
} from './atoms/adapters/McpAuthPromptAdapter.js';
export type { ReasoningCardProps } from './atoms/adapters/ReasoningCardAdapter.js';
export { AttachmentCard, USER_MESSAGE_ATTACHMENT_PREVIEW_REM } from './atoms/AttachmentCard.js';
export type { AttachmentCardProps, AttachmentCardSize } from './atoms/AttachmentCard.js';
export { AttachmentPickerButton } from './atoms/AttachmentPickerButton.js';
export type { AttachmentPickerButtonProps } from './atoms/AttachmentPickerButton.js';
export { AttachmentPreviewDialog } from './atoms/AttachmentPreviewDialog.js';
export type { AttachmentPreviewDialogProps } from './atoms/AttachmentPreviewDialog.js';
export { ComposerLeftSection, ComposerRightSection, ComposerSendButton } from './atoms/ComposerSections.js';
export type {
  ComposerLeftSectionProps,
  ComposerRightSectionProps,
  ComposerSendButtonProps,
} from './atoms/ComposerSections.js';
export { ComposerShell } from './atoms/ComposerShell.js';
export type { ComposerShellProps } from './atoms/ComposerShell.js';
export { ResumeUnavailable } from './atoms/ResumeUnavailable.js';
export type { ResumeUnavailableProps } from './atoms/ResumeUnavailable.js';
export { SandboxToolCallCard } from './atoms/SandboxToolCallCard.js';
export type { SandboxToolCallCardProps } from './atoms/SandboxToolCallCard.js';
export { SubAgentCard } from './atoms/SubAgentCard.js';
export type { SubAgentCardProps } from './atoms/SubAgentCard.js';
export {
  ThreadListEmptyState,
  ThreadListNewButton,
  ThreadListRowSkeleton,
  ThreadListShell,
} from './atoms/ThreadListMisc.js';
export type {
  ThreadListEmptyStateProps,
  ThreadListNewButtonProps,
  ThreadListRowSkeletonProps,
  ThreadListShellProps,
} from './atoms/ThreadListMisc.js';
export { ThreadListRow } from './atoms/ThreadListRow.js';
export type { ThreadListRowProps } from './atoms/ThreadListRow.js';
export { Toast, ToastStack } from './atoms/Toast.js';
export type { ToastProps, ToastStackProps } from './atoms/Toast.js';
export { ToolApprovalBar } from './atoms/ToolApprovalBar.js';
export type { ToolApprovalBarProps } from './atoms/ToolApprovalBar.js';
export { ToolCallCard } from './atoms/ToolCallCard.js';
export type { ToolCallCardProps, ToolCallStatus } from './atoms/ToolCallCard.js';
export { ToolCallContentBlock } from './atoms/ToolCallContentBlock.js';
export type { ToolCallContentBlockProps } from './atoms/ToolCallContentBlock.js';
export { ToolGroupCard } from './atoms/ToolGroupCard.js';
export type { ToolGroupCardProps } from './atoms/ToolGroupCard.js';
export { AgentStepsContainer } from './containers/AgentStepsContainer.js';
export type { AgentStepsContainerProps } from './containers/AgentStepsContainer.js';
export { AskUserContainer } from './containers/AskUserContainer.js';
export { AssistantMessageContainer } from './containers/AssistantMessageContainer.js';
export { AssistantTextContainer } from './containers/AssistantTextContainer.js';
export {
  ComposerAttachmentPickerContainer,
  ComposerAttachmentsContainer,
  MessageAttachmentsContainer,
} from './containers/AttachmentsContainer.js';
export { ComposerContainer } from './containers/ComposerContainer.js';
export type { ComposerContainerProps } from './containers/ComposerContainer.js';
export { HistoryLoaderContainer } from './containers/HistoryLoaderContainer.js';
export { McpAuthContainer } from './containers/McpAuthContainer.js';
export { default as PostMcpOauthScreen } from './containers/McpOauthContainer/PostMcpOauthScreen.js';
export { ReasoningContainer } from './containers/ReasoningContainer.js';
export { ResumeUnavailableContainer } from './containers/ResumeUnavailableContainer.js';
export { Thread } from './containers/Thread.js';
export { ThreadContainer } from './containers/ThreadContainer.js';
export type { ThreadContainerProps } from './containers/ThreadContainer.js';
export { ThreadListContainer } from './containers/ThreadListContainer.js';
export type { ThreadListContainerProps } from './containers/ThreadListContainer.js';
export { ToasterProvider, useToaster, useToasterOptional } from './containers/ToasterContainer.js';
export { ToolApprovalContainer } from './containers/ToolApprovalContainer.js';
export type { ToolApprovalOption } from './containers/ToolApprovalContainer.js';
export { ToolCallContainer } from './containers/ToolCallContainer.js';
export { ToolCallContentBlockContainer } from './containers/ToolCallContentBlockContainer.js';
export { ToolGroupContainer } from './containers/ToolGroupContainer.js';
export type { ThreadGroupPart } from './containers/ToolGroupContainer.js';
export { TrueForgeUI } from './containers/TrueForgeUI.js';
export type {
  ChatLayout,
  RoutePlace,
  RoutesConfig,
  TrueForgeBuiltInServerConfig,
  TrueForgeServerConfig,
  TrueForgeUIProps,
} from './containers/TrueForgeUI.js';
export { TrueFoundryChatProvider } from './containers/TrueFoundryChatProvider.js';
export type { TrueFoundryChatProviderProps } from './containers/TrueFoundryChatProvider.js';
export { UserEditComposerContainer } from './containers/UserEditComposerContainer.js';
export { UserMessageContainer } from './containers/UserMessageContainer.js';
export { ComposerBusyProvider, useComposerBusyState } from './hooks/useComposerBusyState.js';
export type { ComposerBusyState } from './hooks/useComposerBusyState.js';
export { threadHasPendingMcpAuth, useComposerPauseView } from './hooks/useComposerPauseView.js';
export type { ComposerPauseView, ThreadPauseState } from './hooks/useComposerPauseView.js';
export { MCP_AUTH_POPUP_CHANNEL, useMCPAuth } from './hooks/useMcpAuth.js';
export type { McpAuthCallback, McpAuthPopupMessage, UseMCPAuthOptions } from './hooks/useMcpAuth.js';

// Curated chrome hooks (same instance as the SDK runtime). Deep primitives: install @assistant-ui/react.
export { useAui, useAuiState } from './assistant-ui.js';
export type { AssistantState } from './assistant-ui.js';
export { useTheme } from './theme/useTheme.js';

// Runtime / server — consumer surface.
export {
  mergeAgentSpec,
  trueFoundryAttachmentAdapter,
  useTrueFoundryAgentRuntime,
  useTrueFoundryAgentSpec,
  useTrueFoundryCancel,
  useTrueFoundryDownloadSandboxFile,
  useTrueFoundryHistoryPagination,
  useTrueFoundryMcpAuth,
  useTrueFoundryRespondToToolApproval,
  useTrueFoundryToolResponses,
  useTrueFoundryTurnId,
  useTrueFoundryUpdateAgentSpec,
} from '@truefoundry/assistant-ui-runtime';
export type {
  DraftAgentConfig,
  NamedAgentConfig,
  TrueFoundryAgentConfig,
  UseTrueFoundryAgentRuntimeOptions,
} from '@truefoundry/assistant-ui-runtime';

// Server port types + factory
export { ClearChatButton } from './atoms/ClearChatButton.js';
export { SelectAgentEmptyState } from './atoms/SelectAgentEmptyState.js';
export { ShellActionsActionSlot } from './atoms/ShellActionsActionSlot.js';
export { createTrueFoundryServer } from './server/createTrueFoundryServer.js';
export type { CreateTrueFoundryServerOptions, TrueFoundryServer } from './server/createTrueFoundryServer.js';
export {
  ServerProvider,
  useCatalogServer,
  useOptionalCatalogServer,
  useOptionalServer,
  useServer,
  useServerCapabilities,
} from './server/ServerContext.js';
export {
  DEFAULT_AGENT_CONFIG,
  ShellModeProvider,
  libraryAgentId,
  shellIsMutable,
  useOptionalShellMode,
  useShellMode,
} from './server/ShellModeContext.js';
export type { AgentConfig, SelectLibraryAgentRequest, ShellMode } from './server/ShellModeContext.js';
export type {
  AgentBuilderCapabilitiesResponse,
  AgentBuilderServer,
  AgentChatServer,
  AgentLibraryEntry,
  AgentSkill,
  AgentSpec,
  AgentUIServer,
  ApprovalDecision,
  AuthenticateConnectorRequest,
  CatalogServer,
  ConnectorAuth,
  ConnectorAuthApiKey,
  ConnectorAuthNone,
  ConnectorAuthOAuth,
  ConnectorAuthPublic,
  ConnectorAuthPublicApiKey,
  ConnectorAuthPublicNone,
  ConnectorAuthPublicOAuth,
  ConnectorAuthType,
  ConnectorAuthenticationResult,
  ConnectorBase,
  ConnectorCatalogEntry,
  ConnectorCatalogServer,
  ConnectorConfigBase,
  ConnectorState,
  CreateConnectorRequest,
  CreateModelProviderRequest,
  CreateSandboxProviderRequest,
  CreateSessionRequest,
  CreateSkillRequest,
  CreateSkillRequestBase,
  DefinedSkill,
  GithubSkill,
  ImportGithubSkillRequest,
  ListResult,
  ListSessionsOrder,
  ListSessionsParams,
  McpServerMount,
  Model,
  ModelCatalogServer,
  ModelEntry,
  ModelParams,
  ModelProperties,
  ModelProviderBase,
  ModelProviderCatalogEntry,
  ModelProviderConfigBase,
  ModelSelection,
  ModelSelectorEntry,
  PageParams,
  PreviousTurnIdInput,
  ProviderEntry,
  ProviderType,
  RegistrySkill,
  SandboxCatalogServer,
  SandboxProviderBase,
  SandboxProviderCatalogEntry,
  SandboxProviderConfig,
  SandboxProviderListEntry,
  SandboxSnapshotSyncStatus,
  SaveAgentRequest,
  SaveAgentResult,
  SearchAgentsParams,
  SelectRegistrySkillRequest,
  Session,
  SessionEventItem,
  SkillBase,
  SkillCatalogEntry,
  SkillCatalogServer,
  SkillConfigBase,
  SkillMount,
  ToolBase,
  Turn,
  TurnInputItem,
  TurnState,
  TurnStreamData,
  TurnStreamingEvent,
  UpdateConnectorRequest,
  UpdateModelProviderRequest,
  UpdateSandboxProviderRequest,
  UpdateSessionRequest,
  UserMessage,
  UserMessageContent,
  UserToolApprovalEvent,
  UserToolResponseEvent,
} from './server/types.js';

// Utils
export { computeAgentStepsSplit } from './utils/computeAgentStepsSplit.js';
export type { AgentStepPart, AgentStepsSplitResult } from './utils/computeAgentStepsSplit.js';
export { getErrorMessage } from './utils/getErrorMessage.js';

export { AgentsLibrary } from './atoms/AgentsLibrary.js';
export type { AgentsLibraryProps } from './atoms/AgentsLibrary.js';
export { AgentsLibraryButton } from './atoms/AgentsLibraryButton.js';
export type { AgentsLibraryButtonProps } from './atoms/AgentsLibraryButton.js';
export { DraftCatalogProvider, useDraftCatalog } from './atoms/draft/DraftCatalogProvider.js';
export { DraftComposerLeftSection, DraftComposerRightSection } from './atoms/draft/DraftComposerSections.js';
export { DraftCompositeSelector } from './atoms/draft/DraftCompositeSelector.js';
export type { DraftCompositeSelectorProps } from './atoms/draft/DraftCompositeSelector.js';
export { DraftModelSelector } from './atoms/draft/DraftModelSelector.js';
export type { DraftModelSelectorProps } from './atoms/draft/DraftModelSelector.js';
export { SaveAgentButton } from './atoms/SaveAgentButton.js';
