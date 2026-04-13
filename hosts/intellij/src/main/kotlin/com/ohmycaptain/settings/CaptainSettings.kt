package com.ohmycaptain.settings

import com.intellij.openapi.components.*
import com.intellij.openapi.project.Project

@State(
    name = "OhMyCaptainSettings",
    storages = [Storage("oh-my-captain.xml")]  // .idea/oh-my-captain.xml 에 저장
)
@Service(Service.Level.PROJECT)
class CaptainSettingsService : PersistentStateComponent<CaptainSettingsState> {
    private var state = CaptainSettingsState()

    override fun getState() = state
    override fun loadState(state: CaptainSettingsState) { this.state = state }

    companion object {
        fun getInstance(project: Project): CaptainSettingsService =
            project.getService(CaptainSettingsService::class.java)
    }
}

data class CaptainSettingsState(
    var provider: String = "ollama",
    var ollamaBaseUrl: String = "http://localhost:11434",
    var ollamaApiKey: String = "",
    var ollamaModel: String = "qwen3-coder:30b",
    var openAiApiKey: String = "",
    var openAiModel: String = "gpt-4o",
    var openAiBaseUrl: String = "https://api.openai.com/v1",
    var anthropicApiKey: String = "",
    var anthropicModel: String = "claude-sonnet-4-20250514",
    var contextWindow: Int = 32768,
    var requestTimeoutMs: Int = 30000,
    var mode: String = "ask"  // 'plan' | 'ask' | 'auto'
)
