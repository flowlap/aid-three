const DEFAULT_BASE_URL = "https://internal-apigw-kr.hmg-corp.io/hchat-in/api/v3";

export function getHChatBaseUrl(): string {
  return process.env.HCHAT_BASE_URL || DEFAULT_BASE_URL;
}

export function getHChatHeaders(): Record<string, string> {
  const key = process.env.HCHAT_KEY;
  if (!key) {
    throw new Error("HCHAT_KEY 환경변수가 설정되지 않았습니다");
  }
  return { "Content-Type": "application/json", Authorization: key };
}
