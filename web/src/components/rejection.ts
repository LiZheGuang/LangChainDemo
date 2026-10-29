const REJECTION_PREFIX = "用户拒绝了这次工具调用";

/** The middleware hands this text to the model as the tool result, so it must read as a refusal. */
export function rejectionMessage(reason: string): string {
  const trimmed = reason.trim();
  return trimmed ? `${REJECTION_PREFIX}。理由：${trimmed}` : `${REJECTION_PREFIX}。`;
}

export function isRejection(toolResultText: string): boolean {
  return toolResultText.startsWith(REJECTION_PREFIX);
}
