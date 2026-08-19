export const UNTITLED_CHAT_TITLE = 'New Chat';

export function displayChatTitle(title: string | null | undefined): string {
  const trimmed = title?.trim();
  return trimmed ? trimmed : UNTITLED_CHAT_TITLE;
}
