/**
 * 모델 ID 로부터 능력(capabilities) 을 추론하는 유틸.
 * provider 별 명시적 화이트리스트 보다 정규식 우선 — 새 모델이 나와도 패턴 매칭됨.
 */

/**
 * 이미지 입력(비전) 을 지원하는 모델인지 판별.
 * - Anthropic: Claude 3 이상 모두 지원
 * - OpenAI: gpt-4o, gpt-4-turbo, gpt-4-vision 계열, gpt-5
 * - Google: gemini 1.5+, gemma 3+ (gemma 2 는 비전 미지원이므로 버전 명시)
 * - Ollama 커뮤니티 비전 모델: llava, bakllava, moondream, llama-vision,
 *   qwen-vl, granite-vision, minicpm-v, cogvlm, pixtral, internvl, mllama 등
 */
export function isMultimodalModel(modelId: string | undefined | null): boolean {
  if (!modelId) return false
  const m = modelId.toLowerCase()

  // Anthropic Claude 3+ 전체
  if (/claude-(3|opus-4|sonnet-4|haiku-4)/.test(m)) return true

  // OpenAI 비전 모델
  if (/gpt-4o|gpt-4-turbo|gpt-4-vision|gpt-5|o1|o3|o4/.test(m)) return true

  // Google Gemini / Gemma (Gemma 3 부터 비전 지원)
  if (/gemini-(1\.5|1-5|2|2\.0|2-0|2\.5|2-5)/.test(m)) return true
  // gemma3, gemma 3, gemma-3, gemma:3, gemma3:4b, gemma4:31b 등 매칭 (gemma 2 이하 제외)
  if (/gemma[\s\-:_]?(?:[3-9]|1[0-9])/.test(m)) return true

  // Ollama 커뮤니티 비전 모델
  if (/llava|bakllava|moondream|qwen.?2\.?5?.?-?vl|qwen.?-?vl|llama.?3\.?2.?-?vision|llama-vision|mllama|granite-vision|minicpm-v|cogvlm|pixtral|internvl|phi.?3.?5?.?vision/.test(m)) return true

  return false
}
