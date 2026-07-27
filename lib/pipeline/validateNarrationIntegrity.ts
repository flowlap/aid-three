function normalize(text: string): string {
  return text.replace(/\s+/g, "");
}

export function validateNarrationIntegrity(originalText: string, sceneTexts: string[]): boolean {
  return normalize(sceneTexts.join("")) === normalize(originalText);
}
