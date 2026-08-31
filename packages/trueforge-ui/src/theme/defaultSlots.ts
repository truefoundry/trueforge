import { lazy, type ComponentType } from 'react';
import { Accordion, AccordionDetails, AccordionSummary } from '../atoms/primitives/Accordion.js';

import { AgentStepsCard } from '../atoms/adapters/AgentStepsCardAdapter.js';
import { AskUserPrompt } from '../atoms/adapters/AskUserPromptAdapter.js';
import { McpAuthPrompt } from '../atoms/adapters/McpAuthPromptAdapter.js';
import { ReasoningCard } from '../atoms/adapters/ReasoningCardAdapter.js';
import { ResumeUnavailable } from '../atoms/ResumeUnavailable.js';

import { AgentCodeBlock } from '../atoms/agent-details/AgentCodeBlock.js';
import { AgentDetailsHeader } from '../atoms/agent-details/AgentDetailsHeader.js';
import { AgentDetailsPage } from '../atoms/agent-details/AgentDetailsPage.js';
import { AgentDetailsTabs } from '../atoms/agent-details/AgentDetailsTabs.js';
import { AgentDetailsUnavailable } from '../atoms/agent-details/AgentDetailsUnavailable.js';
import { AgentOverviewCard } from '../atoms/agent-details/AgentOverviewCard.js';
import { AgentSessionDetailHeader } from '../atoms/agent-details/AgentSessionDetailHeader.js';
import { AgentSessionListRow } from '../atoms/agent-details/AgentSessionListRow.js';
import { AgentSessionMetricsStrip } from '../atoms/agent-details/AgentSessionMetricsStrip.js';
import { AgentSessionsFilters } from '../atoms/agent-details/AgentSessionsFilters.js';
import { AgentSessionTurnHeader } from '../atoms/agent-details/AgentSessionTurnHeader.js';
import { SessionsPage } from '../atoms/agent-details/SessionsPage.js';
import type {
  AgentCodeSnippetsProps,
  AgentOverviewProps,
  AgentSessionEventTimelineChartProps,
  AgentSessionEventTimelineProps,
  AgentSessionsProps,
} from '../atoms/agent-details/types.js';
import { AgentLibraryRow, AgentsLibrary } from '../atoms/AgentsLibrary.js';
import { AgentsLibraryButton } from '../atoms/AgentsLibraryButton.js';
import { AssistantMessageBubble } from '../atoms/AssistantMessageBubble.js';
import { AttachmentCard } from '../atoms/AttachmentCard.js';
import { AttachmentPickerButton } from '../atoms/AttachmentPickerButton.js';
import { AttachmentPreviewDialog } from '../atoms/AttachmentPreviewDialog.js';
import { ChatFileDownload } from '../atoms/ChatFileDownload.js';
import { ClearChatButton } from '../atoms/ClearChatButton.js';
import { CodeEditor } from '../atoms/CodeEditor.js';
import { ComposerLeftSection, ComposerRightSection, ComposerSendButton } from '../atoms/ComposerSections.js';
import { ComposerShell } from '../atoms/ComposerShell.js';
import { DraftComposerLeftSection, DraftComposerRightSection } from '../atoms/draft/DraftComposerSections.js';
import { DraftCompositeSelector } from '../atoms/draft/DraftCompositeSelector.js';
import { DraftModelSelector } from '../atoms/draft/DraftModelSelector.js';
import { HistoryLoader } from '../atoms/HistoryLoader.js';
import { Markdown } from '../atoms/Markdown.js';
import { MessageActionBar } from '../atoms/MessageActionBar.js';
import { MessageErrorBanner } from '../atoms/MessageErrorBanner.js';
import { MessageIndicator } from '../atoms/MessageIndicator.js';
import { MessageTimestamp } from '../atoms/MessageTimestamp.js';
import { MonacoEditorCore } from '../atoms/MonacoEditorCore.js';
import { OpenUiFenceBlock } from '../atoms/OpenUiFenceBlock.js';
import { SandboxArtifactDownload } from '../atoms/SandboxArtifactDownload.js';
import { SandboxToolCallCard } from '../atoms/SandboxToolCallCard.js';
import { SaveAgentButton } from '../atoms/SaveAgentButton.js';
import { ScrollToBottomButton } from '../atoms/ScrollToBottomButton.js';
import { SelectAgentEmptyState } from '../atoms/SelectAgentEmptyState.js';
import { SessionsBrowserButton } from '../atoms/SessionsBrowserButton.js';
import { ShellActionsActionSlot } from '../atoms/ShellActionsActionSlot.js';
import { MessageListSkeleton } from '../atoms/Skeletons.js';
import { SubAgentCard } from '../atoms/SubAgentCard.js';
import { SyntaxHighlighter } from '../atoms/SyntaxHighlighter.js';
import {
  ThreadListEmptyState,
  ThreadListNewButton,
  ThreadListRowSkeleton,
  ThreadListShell,
} from '../atoms/ThreadListMisc.js';
import { ThreadListRow } from '../atoms/ThreadListRow.js';
import { MessageGroup, ThreadComposerAreaShell, ThreadRootShell, ThreadViewportShell } from '../atoms/ThreadShell.js';
import { Toast, ToastStack } from '../atoms/Toast.js';
import { ToolApprovalBar } from '../atoms/ToolApprovalBar.js';
import { ToolCallCard } from '../atoms/ToolCallCard.js';
import { ToolCallContentBlock } from '../atoms/ToolCallContentBlock.js';
import { ToolGroupCard } from '../atoms/ToolGroupCard.js';
import { UserMessageActionBar } from '../atoms/UserMessageActionBar.js';
import { UserMessageBubble } from '../atoms/UserMessageBubble.js';
import { UserMessageEdit } from '../atoms/UserMessageEdit.js';
import { WelcomeScreen } from '../atoms/WelcomeScreen.js';
import { AgentSessionTimelineContainer } from '../containers/AgentSessionTimelineContainer.js';
import { BrandLogo } from './brand.js';
import type { AtomSlots } from './SlotsProvider.js';

const AgentOverview: ComponentType<AgentOverviewProps> = lazy(() => import('../atoms/agent-details/AgentOverview.js'));
const AgentSessions: ComponentType<AgentSessionsProps> = lazy(async () => {
  const mod = await import('../atoms/agent-details/AgentSessions.js');
  return { default: mod.AgentSessions };
});
const AgentCodeSnippets: ComponentType<AgentCodeSnippetsProps> = lazy(
  () => import('../atoms/agent-details/AgentCodeSnippets.js'),
);
const AgentSessionEventTimeline: ComponentType<AgentSessionEventTimelineProps> = lazy(async () => {
  const mod = await import('../atoms/agent-details/AgentSessionEventTimeline.js');
  return { default: mod.AgentSessionEventTimeline };
});
const AgentSessionEventTimelineChart: ComponentType<AgentSessionEventTimelineChartProps> = lazy(async () => {
  const mod = await import('../atoms/agent-details/AgentSessionEventTimelineChart.js');
  return { default: mod.AgentSessionEventTimelineChart };
});

// ponytail: primitives stay CSS/token-styled (not slots) — see docs/customization.md.
// import { Button } from "../atoms/primitives/Button.js";
// import { Dialog, Modal } from "../atoms/primitives/Dialog.js";
// import { IconButton } from "../atoms/primitives/IconButton.js";
// import { Skeleton } from "../atoms/primitives/Skeleton.js";
// import { LightTooltip } from "../atoms/primitives/Tooltip.js";
// import { Avatar, AvatarFallback, AvatarImage } from "../atoms/primitives/Avatar.js";

/** Default slot implementations. Feature atoms + chrome; primitives via theme/CSS. */
export const defaultSlots = {
  Accordion,
  AccordionSummary,
  AccordionDetails,
  BrandLogo,
  ComposerShell,
  ComposerLeftSection,
  ComposerRightSection,
  ComposerSendButton,
  DraftComposerLeftSection,
  DraftComposerRightSection,
  DraftCompositeSelector,
  DraftModelSelector,
  AssistantMessageBubble,
  UserMessageBubble,
  UserMessageEdit,
  UserMessageActionBar,
  MessageActionBar,
  MessageErrorBanner,
  MessageIndicator,
  MessageTimestamp,
  Markdown,
  SyntaxHighlighter,
  OpenUiFenceBlock,
  SandboxArtifactDownload,
  ChatFileDownload,
  MonacoEditorCore,
  CodeEditor,
  WelcomeScreen,
  ToolCallCard,
  ToolCallContentBlock,
  ToolApprovalBar,
  ToolGroupCard,
  SubAgentCard,
  SandboxToolCallCard,
  AgentStepsCard,
  ReasoningCard,
  AskUserPrompt,
  McpAuthPrompt,
  ResumeUnavailable,
  AttachmentCard,
  AttachmentPreviewDialog,
  AttachmentPickerButton,
  ScrollToBottomButton,
  ThreadListRow,
  ThreadListNewButton,
  AgentsLibrary,
  AgentLibraryRow,
  AgentsLibraryButton,
  SessionsBrowserButton,
  AgentDetailsPage,
  AgentDetailsHeader,
  AgentDetailsTabs,
  AgentDetailsUnavailable,
  AgentOverview,
  AgentOverviewCard,
  AgentSessionDetailHeader,
  AgentSessionsFilters,
  SessionsPage,
  AgentSessionEventTimeline,
  AgentSessionEventTimelineChart,
  AgentSessionListRow,
  AgentSessionMetricsStrip,
  AgentSessionTimelineContainer,
  AgentSessionTurnHeader,
  AgentSessions,
  AgentCodeSnippets,
  AgentCodeBlock,
  SaveAgentButton,
  SelectAgentEmptyState,
  ClearChatButton,
  ThreadListRowSkeleton,
  ThreadListEmptyState,
  ThreadListShell,
  HistoryLoader,
  MessageListSkeleton,
  ThreadRootShell,
  ThreadViewportShell,
  ThreadComposerAreaShell,
  MessageGroup,
  Toast,
  ToastStack,
  ShellActionsActionSlot,
} satisfies AtomSlots;
