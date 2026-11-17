# Project Workflows

Inspect OpenSpec changes and start Codex or Claude Code with the selected change in its Orca worktree.

## Use

Open **Project Workflows** in the right sidebar and select a local workspace. The panel shows active OpenSpec changes, task progress and links to planning artifacts. **Validate specification** runs OpenSpec's structural checks. **Start agent** opens a new session in the selected workspace with the change ID and artifact paths.

The integration supports repo-local changes under `openspec/changes/`. It uses the installed `openspec` executable on Orca's PATH. If unavailable, the panel can read the standard artifact layout and prepare a handoff from those files. Custom schemas and structural validation require the CLI.

**Workspace access.** The worker reads project files and runs OpenSpec locally. Orca capabilities let it list workspaces, open their files and start a selected agent. Windows executable resolution and remote workspaces are outside the initial support scope.

## Develop

```sh
orca plugin types . --json
npm ci
npm run typecheck
orca plugin test . --json
orca plugin check . --json
orca plugin validate . --json
```

Use `orca plugin inspect . --json` to review the local plugin's access and `orca plugin dev watch . --check --json` to load it for development.
