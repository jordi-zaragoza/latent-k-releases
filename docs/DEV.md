# Development Guide

## Modes

### Dev Mode (local source)

Uses the local source code directly. Changes are reflected immediately.

```bash
# Link local project to global npm
cd ~/projects/personal/claude-lk
npm link

# Verify it points to local
ls -la $(which claude-lk)
# Should show: -> ../lib/node_modules/claude-lk/src/cli.js
```

### Binary Mode (production)

Uses compiled binaries for distribution.

```bash
# Build binaries
npm run build          # Current platform only
npm run build:all      # All platforms (linux, macos, win)

# Install binary (replaces npm link)
sudo cp dist/claude-lk-linux /usr/local/bin/claude-lk
chmod +x /usr/local/bin/claude-lk

# Verify
which claude-lk
# Should show: /usr/local/bin/claude-lk
```

## Switching Between Modes

### Switch to Dev Mode

```bash
# Remove binary if installed
sudo rm /usr/local/bin/claude-lk

# Re-link local project
cd ~/projects/personal/claude-lk
npm link
```

### Switch to Binary Mode

```bash
# Unlink npm
npm unlink -g claude-lk

# Install binary
sudo cp dist/claude-lk-linux /usr/local/bin/claude-lk
```

## Logs

Logs only active in dev mode (`LK_DEV=1`). Written to `~/.lk/debug.log`:

```bash
tail -f ~/.lk/debug.log
```

## Environment Variables

- `LK_DEV=1` - Enable dev mode: dev-only CLI commands + logging
- `LK_VERBOSE=1` - Verbose context output (no minification)
