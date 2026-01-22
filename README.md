# Latent-K

Auto-sync context for AI coding assistants (Claude Code, Gemini CLI).

## What is Latent-K?

Latent-K is a CLI tool that automatically provides relevant code context to AI coding assistants. Instead of manually copying files or waiting for the AI to explore your codebase, Latent-K maintains a synchronized understanding of your project and injects the right context at the right time.

### The Problem

When working with AI coding assistants, you often face:
- **Repeated file exploration**: The AI needs to read files to understand your codebase
- **Token waste**: Large portions of context are spent on navigation rather than problem-solving
- **Slow first responses**: Initial questions require multiple file reads before getting useful answers

### The Solution

Latent-K solves this by:
- **Pre-analyzing your codebase**: Understands project structure, dependencies, and code patterns
- **Smart context injection**: Automatically provides relevant files and context based on your prompts
- **Prompt expansion**: Analyzes what you're asking and includes the code context the AI needs
- **Direct answers**: Simple questions get instant answers without file exploration

## Features

- **Prompt expansion**: AI analyzes your prompt and injects relevant code context
- **Direct answers**: Simple questions get instant answers without file reads
- Automatic context injection at session start
- Auto-sync on session end
- Multi-CLI support (Claude Code, Gemini CLI)

## Requirements

- **Operating System**: Linux, macOS, or Windows (x64)
- **AI Provider**: Requires a Gemini API key (free tier available) or Anthropic API key
- **Supported CLIs**: Claude Code and/or Gemini CLI installed

## Installation

### One-liner (Linux/macOS)

```bash
curl -fsSL https://github.com/jordi-zaragoza/latent-k-releases/releases/latest/download/lk-linux -o lk && chmod +x lk && sudo mv lk /usr/local/bin/
```

For macOS, replace `lk-linux` with `lk-macos`.

### Windows (PowerShell)

```powershell
irm https://github.com/jordi-zaragoza/latent-k-releases/releases/latest/download/lk-win.exe -OutFile lk.exe; Move-Item lk.exe $env:LOCALAPPDATA\lk.exe
```

Binary is installed to `/usr/local/bin/lk` (Linux/macOS) or `%LOCALAPPDATA%\lk.exe` (Windows).

## Quick Start

```bash
lk activate   # Enter license key (get free trial at latent-k.com)
lk setup      # Configure AI provider
lk enable     # Enable hooks
lk sync       # Sync project
claude        # Start coding - context is injected automatically
```

## Commands

### License & Setup

| Command | Description |
|---------|-------------|
| `lk activate` | Activate your license key. Get a free trial at [latent-k.com](https://latent-k.com) |
| `lk setup` | Configure your AI provider (Gemini or Anthropic) and API key |

### Sync & Context

| Command | Description |
|---------|-------------|
| `lk sync` | Sync changed files with AI. Analyzes modified files and updates project context |
| `lk sync --all` | Force sync all files, not just changed ones |
| `lk sync <file>` | Force sync a specific file |
| `lk status` | Show project sync status, pending files, and configuration |

### Hooks (Auto-injection)

| Command | Description |
|---------|-------------|
| `lk enable` | Enable hooks for all supported CLIs (Claude Code + Gemini CLI) |
| `lk enable -t claude` | Enable hooks for Claude Code only |
| `lk enable -t gemini` | Enable hooks for Gemini CLI only |
| `lk disable` | Disable hooks for all CLIs |
| `lk disable -t claude` | Disable hooks for Claude Code only |
| `lk disable -t gemini` | Disable hooks for Gemini CLI only |

### Statistics

| Command | Description |
|---------|-------------|
| `lk stats` | Show LLM usage statistics (tokens used, API calls, etc.) |
| `lk stats --reset` | Reset usage statistics |
| `lk savings` | Show estimated time and token savings from using prompt expansion |
| `lk savings --reset` | Reset savings statistics |

### Configuration

| Command | Description |
|---------|-------------|
| `lk ignore <pattern>` | Add a glob pattern to ignore files from sync (e.g., `lk ignore "**/*.log"`) |
| `lk ignore --list` | List all current ignore patterns |
| `lk ignore --remove <pattern>` | Remove an ignore pattern |
| `lk pure` | Check current pure mode status |
| `lk pure on` | Enable pure mode (minimal, machine-to-machine style responses) |
| `lk pure off` | Disable pure mode |

### Maintenance

| Command | Description |
|---------|-------------|
| `lk update` | Update lk to the latest version |
| `lk update --force` | Force update even if already on latest version |
| `lk clean` | Remove all lk data from current project (.lk directory) |
| `lk clean --all` | Remove all lk data including global config and license |
| `lk pro-tips` | Show helpful tips for getting the most out of Latent-K |

### Other

| Command | Description |
|---------|-------------|
| `lk --version` | Show current version |
| `lk --help` | Show help for all commands |
| `lk help <command>` | Show detailed help for a specific command |

## Ignore Patterns

Latent-K uses glob patterns to exclude files from sync:

```bash
# Ignore log files
lk ignore "**/*.log"

# Ignore generated files
lk ignore "**/*.generated.js"

# Ignore test fixtures
lk ignore "**/fixtures/**"

# Ignore specific directory
lk ignore "**/node_modules/**"
```

You can also edit `.lk/ignore` directly in your project.

## Supported CLIs

| CLI | Status |
|-----|--------|
| Claude Code | Supported |
| Gemini CLI | Supported |

## Troubleshooting

### "License not activated" error

Run `lk activate` and enter your license key. If you don't have one, get a free trial at [latent-k.com](https://latent-k.com).

### Context not being injected

1. Make sure hooks are enabled: `lk enable`
2. Check that you've synced at least once: `lk sync`
3. Verify the project has a `.lk` directory

### Sync is slow on first run

The first sync analyzes all files in your project. Subsequent syncs are incremental and much faster.

### "API key not configured" error

Run `lk setup` to configure your AI provider. You'll need either:
- A Gemini API key (free tier available at [aistudio.google.com](https://aistudio.google.com))
- An Anthropic API key

### Hooks not working after CLI update

If you update Claude Code or Gemini CLI, re-enable hooks:
```bash
lk disable
lk enable
```

### How to exclude files from sync

Use `lk ignore` to add patterns:
```bash
lk ignore "**/node_modules/**"
lk ignore "**/*.log"
```

Or edit `.lk/ignore` directly in your project.

## License

Commercial software - license required. Free 14-day trial available at [latent-k.com](https://latent-k.com).
