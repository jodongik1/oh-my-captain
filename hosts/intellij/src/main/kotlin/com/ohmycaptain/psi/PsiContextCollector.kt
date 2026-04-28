package com.ohmycaptain.psi

import com.intellij.openapi.application.ReadAction
import com.intellij.openapi.project.Project
import com.intellij.openapi.vfs.VirtualFile
import com.intellij.psi.PsiDocumentManager
import com.intellij.psi.PsiElement
import com.intellij.psi.PsiFile
import com.intellij.psi.PsiManager
import com.intellij.psi.PsiRecursiveElementVisitor
import com.intellij.psi.util.PsiTreeUtil

/**
 * Core 로 전송되는 파일 컨텍스트 DTO 들.
 *
 * 모든 line 값은 1-base. JSON 직렬화는 Gson 의 데이터클래스 직렬화에 위임한다.
 * 필드명을 바꾸면 Core 측 스키마([context_response] 페이로드)와 어긋나므로 양쪽을 함께 갱신해야 한다.
 */
data class SymbolDto(val kind: String, val name: String, val line: Int)
data class DiagnosticDto(val severity: String, val message: String, val line: Int)
data class FileContextDto(
    val path: String,
    val language: String = "unknown",
    val content: String = "",
    val symbols: List<SymbolDto> = emptyList(),
    val imports: List<String> = emptyList(),
    val diagnostics: List<DiagnosticDto> = emptyList()
)

/**
 * VirtualFile → [FileContextDto] 변환기.
 *
 * 언어별 PSI 분석은 [LanguageSupport] 전략 리스트로 위임 — 새 언어를 추가하려면
 * `LanguageSupport` 구현체 하나만 만들고 [defaultLanguageSupports] 에 등록한다.
 *
 * 의존성 주입: 생성자에서 전략 리스트를 받으므로 단위 테스트에서 가짜 전략을 주입할 수 있다.
 * 운영 코드는 인자 없이 생성하면 [defaultLanguageSupports] 가 사용된다.
 *
 * 동시성: [collect] 는 [ReadAction] 컨텍스트에서 PSI 트리에 접근하여 안전성을 보장한다.
 */
class PsiContextCollector internal constructor(
    private val languageSupports: List<LanguageSupport>,
) {
    constructor() : this(defaultLanguageSupports())

    /** 가용한 전략만 미리 거른 캐시 — 매 파일마다 isAvailable 호출 비용을 피한다. */
    private val activeSupports: List<LanguageSupport> by lazy {
        languageSupports.filter { it.isAvailable() }
    }

    /**
     * 파일 하나를 읽어 컨텍스트 DTO 로 변환.
     *
     * PsiManager 가 PSI 를 만들지 못하는 경우(바이너리·미지원 언어 등) 도 path/content 만 채운
     * 부분 응답을 돌려준다 — Core 가 텍스트 기반으로라도 다룰 수 있게.
     */
    fun collect(project: Project, file: VirtualFile): FileContextDto {
        return ReadAction.compute<FileContextDto, Exception> {
            val psiFile = PsiManager.getInstance(project).findFile(file)
                ?: return@compute FileContextDto(
                    path = file.path,
                    content = String(file.contentsToByteArray(), Charsets.UTF_8)
                )

            FileContextDto(
                path = file.path,
                language = file.fileType.name,
                content = psiFile.text,
                symbols = collectSymbols(psiFile),
                imports = collectImports(psiFile),
                diagnostics = emptyList(),  // Phase 2 에서 InspectionManager 기반으로 구체화 예정
            )
        }
    }

    /**
     * PSI 트리를 재귀 방문하며 모든 활성 전략을 시도해 심볼을 수집.
     *
     * 한 element 에 대해 여러 전략이 시도되지만 보통 하나만 매치된다(언어별로 element 타입이 다르므로).
     * 분기 비용이 미미해 모든 전략을 항상 시도한다.
     */
    private fun collectSymbols(psiFile: PsiFile): List<SymbolDto> {
        val result = mutableListOf<SymbolDto>()
        psiFile.accept(object : PsiRecursiveElementVisitor() {
            override fun visitElement(element: PsiElement) {
                // textOffset 은 0-base char offset → line 으로 변환하면서 1-base 로 +1.
                val doc = PsiDocumentManager.getInstance(psiFile.project).getDocument(psiFile)
                val line = doc?.getLineNumber(element.textOffset)?.plus(1) ?: 0

                for (support in activeSupports) {
                    support.extractSymbol(element, line)?.let { result.add(it) }
                }

                super.visitElement(element)
            }
        })
        return result
    }

    /**
     * import 목록 추출.
     *
     * 가용 전략들에 차례로 위임 — 첫 번째로 non-null 을 돌려주는 전략의 결과를 사용.
     * 어느 전략도 처리하지 못하면 텍스트 기반 fallback (모든 언어에 대한 최후 수단).
     */
    private fun collectImports(psiFile: PsiFile): List<String> {
        for (support in activeSupports) {
            support.extractImports(psiFile)?.let { return it }
        }
        return textBasedImportFallback(psiFile)
    }

    /**
     * fallback: PSI 분류 없이 토큰 텍스트만 보는 단순 휴리스틱.
     *
     * Python/JS/Go 등 미등록 언어를 대충 처리하기 위한 안전망. 정확도가 낮으므로 50개로 절단해
     * 컨텍스트 폭주를 방지한다.
     */
    private fun textBasedImportFallback(psiFile: PsiFile): List<String> =
        PsiTreeUtil.findChildrenOfType(psiFile, PsiElement::class.java)
            .filter { it.text.startsWith("import ") }
            .map { it.text.removePrefix("import ").trim().trimEnd(';') }
            .take(50)
}
