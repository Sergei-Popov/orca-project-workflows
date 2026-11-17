# Project Workflows

Inspect OpenSpec changes and BMAD stories and start Codex or Claude Code in the selected Orca worktree.

## Use

Open **Project Workflows** in the right sidebar and select a local workspace and a method.

### OpenSpec

The panel shows active changes, task progress and links to planning artifacts. **Validate** runs OpenSpec's structural checks. **Start with agent** starts a session in the selected workspace with the change ID and artifact paths.

The integration supports repo-local changes under `openspec/changes/`. It uses an `openspec` executable installed outside the workspace and available on Orca's PATH. If unavailable, the panel reads the standard artifact layout and prepares a handoff from those files. Custom schemas and structural validation require the CLI. OpenSpec 2.1.0 was used for integration verification.

### BMAD Method

The adapter supports BMM from BMAD Method 6.12.4. It reads `stories.yaml` next to `SPEC.md` in the configured output or planning folders and `sprint-status.yaml` in the implementation folder. It follows the project's four TOML configuration layers. Story state comes from the sprint file or the story record when present.

**Continue story** starts the configured agent with the selected story and its related files. **Build a small change** starts the installed `bmad-build` skill with your description. For both actions the prompt asks the agent to present its implementation and checks for review before a commit.

**Workspace access.** The worker reads project files and runs OpenSpec locally. Orca capabilities let it list workspaces, open their files and start a selected agent. The initial support scope is local workspaces. On Windows the worker can resolve a standalone `openspec.exe`; the file view also works when only a shell shim is installed.

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
