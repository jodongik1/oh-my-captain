package com.ohmycaptain.psi

import com.intellij.psi.PsiElement
import com.intellij.psi.PsiFile
import com.ohmycaptain.logging.loggerFor

/**
 * Kotlin PSI 기반 [LanguageSupport].
 *
 * `org.jetbrains.kotlin` 번들 플러그인이 활성화된 환경에서만 동작.
 * import 추출은 현재 미구현 — KtFile 의 importDirectives 를 사용하면 가능하지만 fallback(텍스트 기반)이
 * 충분히 동작해서 보류. 필요해지면 여기에 구현 추가.
 */
internal class KotlinLanguageSupport : LanguageSupport {

    private val log = loggerFor<KotlinLanguageSupport>()

    override val id: String = "kotlin"

    private val available: Boolean by lazy {
        try {
            Class.forName("org.jetbrains.kotlin.psi.KtClassOrObject")
            true
        } catch (_: ClassNotFoundException) {
            false
        }
    }

    override fun isAvailable(): Boolean = available

    override fun extractSymbol(element: PsiElement, line: Int): SymbolDto? {
        return try {
            when (element) {
                is org.jetbrains.kotlin.psi.KtClassOrObject -> SymbolDto("class", element.name ?: "", line)
                is org.jetbrains.kotlin.psi.KtNamedFunction -> SymbolDto("function", element.name ?: "", line)
                is org.jetbrains.kotlin.psi.KtProperty       -> SymbolDto("variable", element.name ?: "", line)
                else -> null
            }
        } catch (e: NoClassDefFoundError) {
            log.debug(e) { "[OMC] Kotlin PSI symbol 추출 실패 — NoClassDefFoundError 안전망" }
            null
        }
    }

    /** 미구현 — null 을 돌려 fallback 텍스트 추출에 위임. */
    override fun extractImports(psiFile: PsiFile): List<String>? = null
}
