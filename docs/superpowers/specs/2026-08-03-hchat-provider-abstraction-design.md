# AI Provider 추상화 및 사내 H-CHAT API 연동 설계

- 작성일: 2026-08-03
- 배경: 현재 LLM은 DeepSeek, 이미지 생성은 OpenAI GPT Image를 직접 호출하는 구조. 사내 게이트웨이 "H-CHAT API"를 새 provider 선택지로 추가하고, 향후 다른 provider 추가도 쉽도록 LLM/이미지 클라이언트를 인터페이스 기반으로 재구성한다.
- 참고: 사내 H-CHAT 연동 패턴은 인접 프로젝트 `/Users/leehj/Projects/aid-one`의 `lib/hchat.ts`, `lib/endpoints.ts`를 참고했다 (게이트웨이가 Claude/ChatGPT/Gemini 3개 벤더를 프록시하는 구조, 인증은 `Authorization` 헤더에 키를 그대로 삽입, Bearer 접두사 없음).

## 목표

- LLM 사용처(DeepSeek)와 이미지 생성 사용처(OpenAI)를 provider 교체 가능한 구조로 재구성한다.
- LLM provider와 이미지 provider를 각각 독립적으로 선택할 수 있어야 하고, provider별 모델명·API 키는 env var로 설정 가능해야 한다.
- 사내에서는 H-CHAT 계열 provider(Claude/ChatGPT/Gemini)를 사용하고, 그 외 환경에서는 기존 DeepSeek/OpenAI를 기본값으로 유지한다. 즉 기존 provider는 제거하지 않고 선택지로 남긴다.
- 인터페이스와 provider별 구현을 분리해 유지보수성을 높인다 (새 provider 추가 시 인터페이스를 구현하는 파일 1개 + factory 분기 1줄만 추가).

## 범위 밖

- UI 설정 화면(설정 값 변경은 `.env` 편집으로만 가능, 런타임 설정 UI는 만들지 않는다).
- TTS 클라이언트(`lib/ai/localTtsClient.ts`)는 이번 개편 대상이 아니다.
- pptx 내보내기, 스토리보드 UI 등 파이프라인 이외 영역은 변경하지 않는다.

## 아키텍처

### 디렉터리 구조

```
lib/ai/
  hchatShared.ts                       # H-CHAT 게이트웨이 공통 URL/인증 헤더 헬퍼
  llm/
    types.ts                           # LlmClient, ChatMessage, LlmTier, LlmCompleteOptions
    factory.ts                         # createLlmClient() — LLM_PROVIDER 읽어 구현체 선택
    mockLlmClient.ts                   # 파이프라인 테스트용 공용 mock (LlmClient 구현)
    deepseekClient.ts / .test.ts       # 기존 RealDeepSeekClient 이동 + LlmClient 구현으로 정리
    hchatClaudeClient.ts / .test.ts    # 신규
    hchatChatGptClient.ts / .test.ts   # 신규
    hchatGeminiClient.ts / .test.ts    # 신규
  image/
    types.ts                           # ImageClient, ImageGenerateOptions
    factory.ts                         # createImageClient() — IMAGE_PROVIDER 읽어 구현체 선택
    mockImageClient.ts                 # 공용 mock
    openaiImageClient.ts / .test.ts    # 기존 로직 이동 + ImageClient 구현으로 정리
    hchatGeminiImageClient.ts / .test.ts # 신규
  localTtsClient.ts / .mock.ts         # 변경 없음
```

### 인터페이스

```ts
// lib/ai/llm/types.ts
export type ChatRole = "system" | "user" | "assistant";
export interface ChatMessage { role: ChatRole; content: string; }

export type LlmTier = "accurate" | "fast";
export interface LlmCompleteOptions {
  tier?: LlmTier;        // 기본값 "accurate"
  jsonMode?: boolean;
  maxTokens?: number;
  signal?: AbortSignal;
}

export interface LlmClient {
  complete(messages: ChatMessage[], options?: LlmCompleteOptions): Promise<string>;
  completeStream(messages: ChatMessage[], options?: LlmCompleteOptions): Promise<AsyncIterable<string>>;
}
```

```ts
// lib/ai/image/types.ts
export interface ImageGenerateOptions {
  quality?: string;
  size?: string;
  signal?: AbortSignal;
  referenceImages?: Buffer[];
}

export interface ImageClient {
  generateImage(prompt: string, options?: ImageGenerateOptions): Promise<Buffer>;
}
```

기존 `LlmCompleteOptions.model` 옵션은 제거하고 `tier`로 대체한다. 파이프라인 스텝은 구체 모델명을 몰라도 되고, "정확도우선(accurate)"과 "비용효율(fast)" 중 하나만 선언한다. 실제 모델명 매핑은 각 provider 구현체 내부 책임이다.

**tier 매핑 근거**: 현재 `DEEPSEEK_MODELS.pro`(정확도 중시: `convertMarkdown`, `splitScenes`, `analyzeSceneRelations`)와 `.flash`(비용/속도 중시: `summarizeDocument`, `selectScreenTypes`, `reviewConsistency`) 구분을 그대로 `accurate`/`fast` tier로 승격한다.

### Provider 목록 및 기본 모델명

**LLM** (`LLM_PROVIDER`, 기본값 `deepseek`):

| provider | accurate | fast |
|---|---|---|
| `deepseek` | `deepseek-v4-pro` | `deepseek-v4-flash` |
| `hchat-claude` | `claude-sonnet-5` | `claude-haiku-4-5` |
| `hchat-chatgpt` | `gpt-5.6-terra` | `gpt-5.6-luna` |
| `hchat-gemini` | `gemini-3.6-flash` | `gemini-3.5-flash-lite` |

**이미지** (`IMAGE_PROVIDER`, 기본값 `openai`):

| provider | 모델 |
|---|---|
| `openai` | `gpt-image-2` |
| `hchat-gemini` | `gemini-3.1-flash-image` |

### Provider 팩토리

```ts
// lib/ai/llm/factory.ts
export type LlmProviderType = "deepseek" | "hchat-claude" | "hchat-chatgpt" | "hchat-gemini";

export function createLlmClient(): LlmClient {
  const provider = (process.env.LLM_PROVIDER ?? "deepseek") as LlmProviderType;
  switch (provider) {
    case "deepseek": return createDeepSeekClient();
    case "hchat-claude": return createHChatClaudeClient();
    case "hchat-chatgpt": return createHChatChatGptClient();
    case "hchat-gemini": return createHChatGeminiClient();
    default: throw new Error(`Unknown LLM_PROVIDER: ${provider}`);
  }
}
```

`lib/ai/image/factory.ts`도 `ImageProviderType = "openai" | "hchat-gemini"`로 동일한 패턴을 따른다.

각 `create*Client()`는 자기 자신의 env var만 읽고, 필요한 키가 없으면 즉시 throw한다(기존 `createDeepSeekClient()` 관례 유지).

### env var 구성

provider별 전용 변수를 유지한다(공통 단일 키 변수로 통합하지 않음) — 여러 provider의 키를 `.env`에 동시에 넣어두고 `LLM_PROVIDER`/`IMAGE_PROVIDER`만 바꿔가며 테스트할 수 있어야 하기 때문이다.

```
# LLM
LLM_PROVIDER=deepseek        # deepseek | hchat-claude | hchat-chatgpt | hchat-gemini
DEEPSEEK_API_KEY=
DEEPSEEK_MODEL_ACCURATE=     # 생략 시 deepseek-v4-pro
DEEPSEEK_MODEL_FAST=         # 생략 시 deepseek-v4-flash

# Image
IMAGE_PROVIDER=openai        # openai | hchat-gemini
OPENAI_API_KEY=
OPENAI_IMAGE_MODEL=          # 생략 시 gpt-image-2

# H-CHAT (사내 게이트웨이 — LLM 3종 + 이미지 1종 공통)
HCHAT_KEY=
HCHAT_BASE_URL=              # 생략 시 https://internal-apigw-kr.hmg-corp.io/hchat-in/api/v3
HCHAT_CLAUDE_MODEL_ACCURATE=     # 생략 시 claude-sonnet-5
HCHAT_CLAUDE_MODEL_FAST=         # 생략 시 claude-haiku-4-5
HCHAT_CHATGPT_MODEL_ACCURATE=    # 생략 시 gpt-5.6-terra
HCHAT_CHATGPT_MODEL_FAST=        # 생략 시 gpt-5.6-luna
HCHAT_GEMINI_MODEL_ACCURATE=     # 생략 시 gemini-3.6-flash
HCHAT_GEMINI_MODEL_FAST=         # 생략 시 gemini-3.5-flash-lite
HCHAT_GEMINI_IMAGE_MODEL=        # 생략 시 gemini-3.1-flash-image
```

`HCHAT_KEY`, `HCHAT_BASE_URL`은 `lib/ai/hchatShared.ts`에서 한 곳에 모아 읽고, LLM 3종 + 이미지 1종 클라이언트가 공유한다.

```ts
// lib/ai/hchatShared.ts
export function getHChatBaseUrl(): string {
  return process.env.HCHAT_BASE_URL ?? "https://internal-apigw-kr.hmg-corp.io/hchat-in/api/v3";
}

export function getHChatHeaders(): Record<string, string> {
  const key = process.env.HCHAT_KEY;
  if (!key) throw new Error("HCHAT_KEY가 설정되지 않았습니다.");
  return { "Content-Type": "application/json", Authorization: key };
}
```

### 벤더별 요청/응답 포맷

| Provider | 엔드포인트 | 요청 포맷 |
|---|---|---|
| `hchat-claude` | `{base}/claude/messages` | Anthropic Messages API (`model`, `max_tokens`, `system`, `messages`, `stream`) |
| `hchat-chatgpt` | `{base}/openai/deployments/{model}/chat/completions` | Azure OpenAI 배포 경로 + `messages` 배열 |
| `hchat-gemini` (텍스트) | `{base}/models/{model}:streamGenerateContent` / `:generateContent` | Gemini `contents`/`parts`, `systemInstruction` |
| `hchat-gemini` (이미지) | 동일 Gemini 엔드포인트 | `inline_data` 이미지 파트 + `generationConfig.responseModalities: ["IMAGE","TEXT"]` |

각 벤더의 요청/응답 변환 로직은 해당 클라이언트 파일 내부에 캡슐화하고, 공통 인터페이스(`LlmClient`/`ImageClient`) 밖으로 새어나가지 않게 한다.

### jsonMode 처리 (벤더별 상이)

- `deepseek` / `hchat-chatgpt`: OpenAI 호환 `response_format: { type: "json_object" }`
- `hchat-claude`: 네이티브 JSON 모드가 없어 system 프롬프트에 "JSON으로만 응답" 지시를 추가. 파싱 실패 시 별도 재시도 없이 에러를 던지고, 파싱 책임은 기존과 동일하게 호출한 파이프라인 스텝에 있다.
- `hchat-gemini`: `generationConfig.responseMimeType: "application/json"`

### 스트리밍

`completeStream`은 `convertMarkdown`, `splitScenes`, `reviewConsistency` 3개 파이프라인 스텝에서 실사용되므로 4개 LLM provider 모두 필수 구현한다. 벤더별 SSE 파싱 로직(`aid-one`의 `createClaudeSSEStream`, `streamChatGPTText`, `streamGeminiText` 참고)은 각 클라이언트 파일 내부에 둔다. `[DONE]` 감지처럼 공통화 가능한 부분만 `hchatShared.ts`에 헬퍼로 뺀다 — 억지로 통합하지 않는다.

### 에러 처리 및 truncation 감지

- H-CHAT 4개 클라이언트 모두 `Error("H-Chat 오류 (${status}): ...")` 포맷을 통일한다(aid-one 관례).
- `HCHAT_KEY` 미설정 시 팩토리 생성 시점에 즉시 throw한다.
- 기존 `RealDeepSeekClient`의 응답 잘림(truncation) 감지 로직은 DeepSeek의 `finish_reason` 필드를 체크한다. Claude(`stop_reason`)/ChatGPT(`finish_reason`)/Gemini(`finishReason`)도 각자의 필드로 동일한 개념을 이식하되, 공통 인터페이스로 강제하지 않고 각 구현체가 필요 시 내부적으로 처리한다.

## 마이그레이션 범위

**파이프라인 스텝 (`lib/pipeline/*.ts`)** — import를 `../ai/deepseekClient` → `../ai/llm/types`로, `DEEPSEEK_MODELS.pro/.flash` → `{ tier: "accurate" }` / `{ tier: "fast" }`로 교체:
- accurate: `convertMarkdown.ts`, `splitScenes.ts`, `analyzeSceneRelations.ts`
- fast: `selectScreenTypes.ts`, `reviewConsistency.ts`, `summarizeDocument.ts`

**이미지 파이프라인 스텝**: `generateSceneImage.ts` — import를 `../ai/openaiImageClient` → `../ai/image/types`로 변경. 인터페이스 시그니처가 동일하므로 로직 변경은 없다.

**API 라우트** — 구체 클라이언트 생성 함수를 팩토리 호출로 교체:
- `createDeepSeekClient()` → `createLlmClient()`: `scenes/route.ts`, `scenes/analyze/route.ts`, `screen-design/route.ts`, `screen-design/[sceneId]/route.ts`, `markdown/route.ts`, `review/route.ts`
- `createOpenaiImageClient()` → `createImageClient()`: `images/route.ts`, `images/presenter-reference/generate/route.ts`, `images/background-reference/generate/route.ts`, `images/[sceneId]/route.ts`

**기존 테스트 (7개 파이프라인 테스트)** — `expect(client.calls[0].options?.model).toBe("deepseek-v4-pro")` 형태의 단언을 `expect(client.calls[0].options?.tier).toBe("accurate")` 형태로 변경. import도 `deepseekClient.mock.ts` → `llm/mockLlmClient.ts` (이미지 테스트는 `image/mockImageClient.ts`)로 교체.

**신규 파일**: `hchatShared.ts`, `llm/{hchatClaudeClient,hchatChatGptClient,hchatGeminiClient}.ts`(+ mock + test 각각), `image/hchatGeminiImageClient.ts`(+ mock + test), `llm/factory.ts`(+ test), `image/factory.ts`(+ test).

신규 Real 클라이언트 테스트는 기존 `deepseekClient.test.ts` 패턴(전역 `fetch` mock으로 요청 URL·헤더·바디 검증, SSE 스트림 파싱 검증)을 따른다.

## 하위 호환성

- `LLM_PROVIDER`/`IMAGE_PROVIDER`를 설정하지 않으면 기존과 동일하게 `deepseek`/`openai`가 사용되므로, 기존 `.env` 설정을 가진 환경은 변경 없이 그대로 동작한다.
- `.env.example`은 위 "env var 구성" 절의 전체 목록으로 갱신한다.

## 테스트 전략

1. 각 Real 클라이언트: `fetch`를 mock하여 요청 URL/헤더/바디가 벤더 스펙에 맞게 구성되는지, 응답을 올바르게 파싱하는지, 스트리밍/jsonMode/에러 케이스를 검증.
2. `llm/factory.ts`, `image/factory.ts`: env var 조합별로 올바른 구현체가 반환되는지, 알 수 없는 provider 값에 대해 throw하는지 검증.
3. 파이프라인 스텝: 기존처럼 공용 mock client를 주입해 `tier` 옵션이 올바르게 전달되는지만 검증 (provider 종류와 무관).

## 미해결/확인 필요 항목

없음 — 모델명, env var 구조, provider 세분화, tier 매핑 방식 모두 사용자 확인 완료.
