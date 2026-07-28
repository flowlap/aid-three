function stripMarkdown(text: string): string {
  return text
    .split(/\r?\n/)
    .map((line) =>
      line
        // heading markers: "# ", "## ", ... "###### "
        .replace(/^\s{0,3}#{1,6}\s+/, "")
        // bullet list markers: "- ", "* ", "+ "
        .replace(/^\s{0,3}[-*+]\s+/, "")
        // numbered list markers: "1. ", "2) ", ...
        .replace(/^\s{0,3}\d+[.)]\s+/, "")
    )
    .join("\n")
    .replace(/\*\*(.+?)\*\*/g, "$1") // bold
    .replace(/\*(.+?)\*/g, "$1") // italic (asterisk)
    .replace(/_(.+?)_/g, "$1") // italic/underscore emphasis
    .replace(/`([^`]+?)`/g, "$1"); // inline code
}

function normalize(text: string): string {
  return stripMarkdown(text).replace(/\s+/g, "");
}

export function validateNarrationIntegrity(originalText: string, sceneTexts: string[]): boolean {
  return normalize(sceneTexts.join("")) === normalize(originalText);
}
