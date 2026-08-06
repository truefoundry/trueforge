import { Accordion, AccordionDetails, AccordionSummary } from '../atoms/primitives/Accordion.js';

import { AgentStepsCard } from '../atoms/adapters/AgentStepsCardAdapter.js';
import { AskUserPrompt } from '../atoms/adapters/AskUserPromptAdapter.js';
import { McpAuthPrompt } from '../atoms/adapters/McpAuthPromptAdapter.js';
import { ReasoningCard } from '../atoms/adapters/ReasoningCardAdapter.js';

import { AgentsLibraryButton } from '../atoms/AgentsLibraryButton.js';
import { AssistantMessageBubble } from '../atoms/AssistantMessageBubble.js';
import { AttachmentCard } from '../atoms/AttachmentCard.js';
import { AttachmentPickerButton } from '../atoms/AttachmentPickerButton.js';
import { AttachmentPreviewDialog } from '../atoms/AttachmentPreviewDialog.js';
import { ClearChatButton } from '../atoms/ClearChatButton.js';
import { ComposerLeftSection, ComposerRightSection, ComposerSendButton } from '../atoms/ComposerSections.js';
import { ComposerShell } from '../atoms/ComposerShell.js';
import { HistoryLoader } from '../atoms/HistoryLoader.js';
import { Markdown } from '../atoms/Markdown.js';
import { MessageActionBar } from '../atoms/MessageActionBar.js';
import { MessageErrorBanner } from '../atoms/MessageErrorBanner.js';
import { MessageIndicator } from '../atoms/MessageIndicator.js';
import { MessageTimestamp } from '../atoms/MessageTimestamp.js';
import { OpenUiFenceBlock } from '../atoms/OpenUiFenceBlock.js';
import { SandboxArtifactDownload } from '../atoms/SandboxArtifactDownload.js';
import { SandboxToolCallCard } from '../atoms/SandboxToolCallCard.js';
import { ScrollToBottomButton } from '../atoms/ScrollToBottomButton.js';
import { MessageListSkeleton } from '../atoms/Skeletons.js';
import { SubAgentCard } from '../atoms/SubAgentCard.js';
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
import type { AtomSlots } from './SlotsProvider.js';

// ponytail: primitives stay CSS/token-styled (not slots) — see docs/customization.md.
// import { Button } from "../atoms/primitives/Button.js";
// import { Dialog, Modal } from "../atoms/primitives/Dialog.js";
// import { IconButton } from "../atoms/primitives/IconButton.js";
// import { Skeleton } from "../atoms/primitives/Skeleton.js";
// import { LightTooltip } from "../atoms/primitives/Tooltip.js";
// import { Avatar, AvatarFallback, AvatarImage } from "../atoms/primitives/Avatar.js";

/** Default slot implementations. Feature atoms + chrome; primitives via theme/CSS. */
export const defaultSlots: AtomSlots = {
  Accordion,
  AccordionSummary,
  AccordionDetails,
  ComposerShell,
  ComposerLeftSection,
  ComposerRightSection,
  ComposerSendButton,
  AssistantMessageBubble,
  UserMessageBubble,
  UserMessageEdit,
  UserMessageActionBar,
  MessageActionBar,
  MessageErrorBanner,
  MessageIndicator,
  MessageTimestamp,
  Markdown,
  OpenUiFenceBlock,
  SandboxArtifactDownload,
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
  AttachmentCard,
  AttachmentPreviewDialog,
  AttachmentPickerButton,
  ScrollToBottomButton,
  ThreadListRow,
  ThreadListNewButton,
  AgentsLibraryButton,
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
};

declare module './SlotsProvider.js' {
  interface AtomSlots {
    Accordion: typeof Accordion;
    AccordionSummary: typeof AccordionSummary;
    AccordionDetails: typeof AccordionDetails;
    OpenUiFenceBlock: typeof OpenUiFenceBlock;
  }
}
