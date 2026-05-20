export async function copyTextToClipboard(text: string): Promise<void> {
  await navigator.clipboard.writeText(text);
}
