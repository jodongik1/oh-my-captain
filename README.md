# Oh My Captain

> **Local AI coding agent for IntelliJ IDEs**  
> Powered by Ollama, OpenAI, or Anthropic — runs entirely in your IDE.

![Plugin Version](https://img.shields.io/badge/version-0.1.0-blue)
![IntelliJ Platform](https://img.shields.io/badge/IntelliJ-2025.1%2B-orange)
![Node.js](https://img.shields.io/badge/Node.js-20%2B-green)
![License](https://img.shields.io/badge/license-MIT-lightgrey)

---

## Overview

Oh My Captain is an IntelliJ IDEA plugin that embeds a full-featured AI coding agent directly in your IDE. Unlike simple autocomplete or chat tools, Captain autonomously **reads files, writes code, runs terminal commands**, and explains its reasoning — all without leaving your editor.

```
┌──────────────────────────────────────────────────────┐
│  IntelliJ Plugin (Kotlin)                            │
│  Tool Window · JBCef WebView · PSI Context           │
└────────────────────┬─────────────────────────────────┘
                     │  Stdio IPC (NDJSON)
┌────────────────────▼─────────────────────────────────┐
│  Core Agent (TypeScript / Node.js)                   │
│  ReAct Loop · LLM Providers · Tool Registry          │
└────────────────────┬─────────────────────────────────┘
                     │  JBCef JS Bridge
┌────────────────────▼─────────────────────────────────┐
│  Chat UI (React + Vite)                              │
│  Timeline · Settings · Session History               │
└──────────────────────────────────────────────────────┘
```

---

## Features

### 🤖 Agentic Loop
- ReAct (Reason + Act) loop — up to 20 iterations per task
- Streams responses token-by-token in real time
- Automatic context window management with truncation

### 🛠️ Built-in Tools
| Tool | Description |
|---|---|
| `read_file` | Read any file in the project |
| `write_file` | Create or overwrite files |
| `run_terminal` | Execute shell commands (stdout/stderr captured) |

### 🔒 Permission Modes
| Mode | Behavior |
|---|---|
| **Ask before edits** | Approval dialog before every file write or terminal command |
| **Edit automatically** | Executes actions without confirmation |
| **Plan mode** | Read-only exploration, presents a plan before acting |

### 🎯 Code Actions
Right-click any code in the editor to trigger:
- **Explain This Code** — Plain-language explanation
- **Review This Code** — Code quality review
- **Impact Analysis** — Upstream/downstream change analysis
- **Query Validation** — SQL query correctness check
- **Improve This Code** — Refactoring suggestions
- **Generate Test** — Unit test generation

### 🧠 LLM Providers
- **Ollama** (local, default) — any model including `qwen`, `llama`, `codestral`
- **OpenAI** — GPT-4o, GPT-4-turbo, and OpenAI-compatible endpoints
- **Anthropic** — Claude 3.5 Sonnet, Claude 3 Opus (with extended thinking support)

### 💬 Session Management
- Persistent chat history saved to `~/.omc/sessions.db`
- Session list, rename, and delete from the UI
- Auto-generated session titles based on conversation content

---

## Requirements

| Dependency | Version |
|---|---|
| IntelliJ IDEA (Community or Ultimate) | 2025.1+ |
| Java (for Gradle build) | 17+ |
| Node.js | 20+ |
| pnpm | 8+ |

> **LLM Backend**: At least one of Ollama (local), OpenAI API key, or Anthropic API key is required.

---

## Getting Started

### 1. Clone the repository

```bash
git clone https://github.com/your-org/oh-my-captain.git
cd oh-my-captain
```

### 2. Build and run

```bash
# Full build + launch IntelliJ with plugin loaded
./build-and-run.sh

# Or step by step:
./build-and-run.sh build   # Build only (Core + Webview)
./build-and-run.sh run     # Launch IntelliJ (uses previous build)
```

The script will:
1. Install Node.js dependencies via `pnpm`
2. Bundle the TypeScript core with `esbuild`
3. Build the React webview with `Vite`
4. Launch a sandboxed IntelliJ instance via Gradle `runIde`

### 3. Configure a provider

On first launch, the plugin will prompt you to configure a provider.

**Ollama (recommended for local use)**
```bash
# Install Ollama
brew install ollama

# Pull a model
ollama pull qwen2.5-coder:7b

# Start the server
ollama serve
```

Then in Oh My Captain settings: set Base URL to `http://localhost:11434` and select your model.

---

## Project Structure

```
oh-my-captain/
├── build-and-run.sh              # One-shot build & launch script
├── package.json                  # pnpm workspace root
├── pnpm-workspace.yaml
│
├── hosts/
│   └── intellij/                 # Kotlin IntelliJ plugin
│       ├── build.gradle.kts
│       ├── gradle.properties     # Plugin version & platform config
│       └── src/main/kotlin/com/ohmycaptain/
│           ├── actions/          # Editor context menu actions
│           ├── bridge/           # JBCef ↔ Core message bridge
│           ├── core/             # Node.js process lifecycle
│           ├── ipc/              # Stdio NDJSON client
│           ├── psi/              # IntelliJ PSI context collector
│           ├── settings/         # Plugin settings persistence
│           └── ui/               # Tool window, approval dialog
│
└── packages/
    ├── core/                     # TypeScript agent core (Node.js)
    │   └── src/
    │       ├── main.ts           # IPC server + all message handlers
    │       ├── agent/            # ReAct loop, context, compactor
    │       ├── providers/        # Ollama, OpenAI, Anthropic
    │       ├── tools/            # Tool registry + implementations
    │       ├── ipc/              # Protocol types, stdio server
    │       ├── host/             # HostAdapter interface + IPC impl
    │       ├── settings/         # Settings types + file manager
    │       ├── db/               # SQLite session storage
    │       └── actions/          # Code action handlers + prompts
    │
    └── webview/                  # React + Vite chat UI
        └── src/
            ├── App.tsx           # Root: host message routing
            ├── store.ts          # Global state (useReducer)
            ├── bridge/           # JBCef postMessage bridge
            └── components/
                ├── timeline/     # StreamRow, ToolRow, BashRow, ...
                ├── settings/     # Settings panel
                └── ...           # Header, Input, History, Mode, ...
```

---

## Development

### Build individual packages

```bash
# Core only (TypeScript → esbuild bundle)
./build-and-run.sh core

# Webview only (Vite)
./build-and-run.sh webview

# Webview hot-reload dev server (port 5173)
pnpm --filter @omc/webview dev
# Then launch IDE with: JAVA_TOOL_OPTIONS="-Domc.dev=true" ./build-and-run.sh run
```

### IPC Protocol

Communication between Kotlin and Node.js uses **NDJSON over stdio** (one JSON object per line).

```
IntelliJ → Core : init | user_message | abort | settings_get | ...
Core → IntelliJ : stream_chunk | stream_end | tool_start | tool_result | error | ...
```

See [`packages/core/src/ipc/protocol.ts`](packages/core/src/ipc/protocol.ts) for the full type definitions.

### Runtime data

User settings and session history are stored in `~/.omc/`:

```
~/.omc/
├── settings.json     # Provider config, model selection
├── sessions.db       # SQLite: conversation history
└── logs/             # Agent stderr logs
```

---

## Configuration

Settings are persisted to `~/.omc/settings.json` and can be edited via the in-plugin settings panel (`/settings` slash command or gear icon).

```json
{
  "provider": {
    "provider": "ollama",
    "ollamaBaseUrl": "http://localhost:11434",
    "ollamaModel": "qwen2.5-coder:7b",
    "openAiApiKey": "",
    "openAiModel": "gpt-4o",
    "anthropicApiKey": "",
    "anthropicModel": "claude-sonnet-4-5"
  },
  "model": {
    "contextWindow": 32768,
    "requestTimeoutMs": 120000
  }
}
```

### Project-level rules

Create `.captain/rules.md` in your project root to give Captain persistent context about your project:

```markdown
# Project Rules

- Always write tests for new functions
- Use Kotlin coroutines, not callbacks
- Follow the existing package structure
```

---

## Slash Commands

Type `/` in the input field to see available commands:

| Command | Description |
|---|---|
| `/clear` | Clear the current conversation |
| `/new` | Start a new session |
| `/explain` | Explain selected/open file code |
| `/review` | Review code quality |
| `/improve` | Suggest improvements |
| `/test` | Generate unit tests |
| `/model` | Switch LLM model |
| `/settings` | Open settings panel |

---

## Roadmap

- [ ] **@-mention file references** — `@src/Main.kt` to explicitly include files in context
- [ ] **Native diff viewer** — Review file changes with Accept/Reject in IntelliJ's built-in diff UI
- [ ] **Plan Mode improvements** — True read-only exploration with one-click plan execution
- [ ] **/compact command** — Manual context compression to free up token space
- [ ] **Git workflow** — `/commit` and `/pr` automation
- [ ] **Image input** — Paste screenshots for UI analysis

---

## Contributing

1. Fork the repository
2. Create a feature branch: `git checkout -b feat/my-feature`
3. Make your changes and test with `./build-and-run.sh`
4. Open a Pull Request

---

## License

MIT © Oh My Captain Contributors
