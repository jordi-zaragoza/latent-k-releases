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

## Easy Start

```bash
lk activate   # Enter license key (get free trial at latent-k.com)
lk setup      # Configure AI provider
lk enable     # Enable hooks
lk sync       # Sync project
claude        # Start coding - context is injected automatically
```

## Getting the Most Out of Latent-K

For each project, follow these steps to optimize your workflow.

1. **Initial sync**: Run `lk sync` in your project root. The output shows which files are synced and which are ignored. By default, only the most relevant files are synced to optimize token usage.

2. **Adjust ignore patterns**: Use `lk ignore -l` to list ignored files, `lk ignore -a <pattern>` to add patterns, or `lk ignore -r <pattern>` to remove them.

3. **Full sync**: Once configured, run `lk sync --all` to sync all remaining files.

> ⚠️ **Warning**: `lk sync --all` on large projects with a free Gemini API tier can quickly exhaust your token quota.

4. **Inject context on demand**: Context is automatically injected at session start. Prefix any prompt with `lk` to refresh context mid-session (e.g., `lk how does auth work?`).

5. **Manage long conversations**: Use `/clear` when switching topics, or `/compact` to compress context in long sessions.

## Commands

| Command | Description |
|---------|-------------|
| `lk activate` | Activate license |
| `lk setup` | Configure AI provider |
| `lk sync` | Manual sync |
| `lk sync --all` | Sync all pending files |
| `lk status` | Show project status |
| `lk enable` | Enable hooks (both CLIs) |
| `lk enable -t claude` | Enable for Claude Code only |
| `lk enable -t gemini` | Enable for Gemini CLI only |
| `lk disable` | Disable hooks |
| `lk ignore -l` | List ignored files |
| `lk ignore -a <pattern>` | Add ignore pattern |
| `lk ignore -r <pattern>` | Remove ignore pattern |
| `lk stats` | Show LLM usage statistics |
| `lk savings` | Show estimated time/token savings |
| `lk pro-tips` | Show all LK pro tips |
| `lk update` | Update to latest version |
| `lk clean` | Remove lk data |

## Ignore Patterns

```bash
lk ignore -l                        # List ignored files
lk ignore -a "**/*.generated.js"    # Add pattern
lk ignore -r "**/fixtures/**"       # Remove pattern
```

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

```bash
lk ignore -a "**/node_modules/**"
lk ignore -a "**/*.log"
```

Or edit `.lk/ignore` directly.

## Benchmarks

- [Small project benchmark (PDF)](benchmarks/benchmark_small.pdf) - 6,596 files, **1.38x faster**
- [Large project benchmark (PDF)](benchmarks/benchmark_big.pdf) - 27,985 files, **1.61x faster**

## Support

For questions or issues, contact us at [info@latentk.org](mailto:info@latentk.org).

## License

Commercial software - license required. Free 14-day trial available.
