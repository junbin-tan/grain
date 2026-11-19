---
name: worktree
description: Branch a plan out into its own git worktree, move this conversation into it, build the change there, and launch that branch's Grain app for testing next to the main checkout. Use for /worktree, "branch this out", "make a worktree for this plan", "spin up a branch so I can test it".
---

# /worktree: plan → worktree + branch → build → run it

Goal: the user ends up talking to you **inside** a new worktree on a new branch, with the change built and the branch's app running so they can try it.

## 1. Pin down the plan

- Use the plan in the skill args or the one just discussed in the conversation. If neither exists, ask for it in one question and stop.
- Name the branch `<type>/<kebab-slug>`, where type is `feat`, `fix` or `chore` (for example `feat/speaker-labels`). If `git branch --list <name>` already finds it, add `-2`.
- Base it on the current branch (`git branch --show-current`). Run `git status --short`. If there are uncommitted changes, tell the user they will **not** carry over into the worktree, and ask whether to commit them first.

## 2. Create the worktree and move into it

**In T3 Code** (`t3_worktree_handoff` exists): make it the **last tool call of the turn**:

```
t3_worktree_handoff({
  branch: "<branch>",
  baseRef: "<current branch>",
  startFromOrigin: false,
  runSetupScript: true,
  continuationPrompt: "<see below>"
})
```

The project's setup script (`scripts/worktree-setup.sh`, registered in T3 with `runOnWorktreeCreate`) runs in the new worktree. If the project has no such script yet, add one with `t3_project_update`: `{id:"worktree-setup", name:"Worktree setup", command:"scripts/worktree-setup.sh", icon:"configure", runOnWorktreeCreate:true}`. Keep the scripts that are already there.

`continuationPrompt` must stand alone. Put in it: the full plan text, the branch name, and the instruction "You are now in the worktree. Run `scripts/worktree-setup.sh` if `node_modules` is missing, then do steps 3 and 4 of the /worktree skill."

**In plain Claude Code** (no T3 tools):

```bash
git worktree add -b <branch> ../grain-worktrees/<slug> <current branch>
(cd ../grain-worktrees/<slug> && scripts/worktree-setup.sh)
```

Then call `EnterWorktree` with `path: <absolute path of ../grain-worktrees/<slug>>` and continue with step 3 in the same turn.

## 3. Build the plan (inside the worktree)

- Run `pwd` and `git branch --show-current` first. If you are not in the worktree, stop and say so.
- Implement the plan. Then run the checks: `npm run typecheck && npm run lint && npm test`, and add `(cd src-tauri && cargo test --lib)` if Rust changed. Fix what fails.
- Commit on the branch with a clear message. Do not push and do not open a PR unless the user asks.

## 4. Launch it for testing

Start `scripts/worktree-dev.sh` with `run_in_background: true`. It:
- picks the first free Vite port from 1421, so the main checkout's `npx tauri dev` on 1420 can keep running;
- uses its own data folder, `~/Library/Application Support/computer.grain.app-worktrees/<branch with / replaced by ->`, so your real meetings and database are never touched. Models are cloned in copy-on-write, so nothing is downloaded again.

The first Rust build takes a few minutes. Wait until the output shows the app running (`Running \`target/debug/grain\``), or until it fails. Then tell the user:
- branch, worktree path, port and data folder;
- what to click to test the change;
- `GRAIN_WT_FRESH=1 scripts/worktree-dev.sh` wipes this branch's test data and starts clean.

## Cleanup (only when the user asks)

```bash
git worktree remove <path>          # refuses if there are uncommitted changes, which is good
git branch -d <branch>              # -d refuses if unmerged; ask before using -D
rm -rf "$HOME/Library/Application Support/computer.grain.app-worktrees/<branch with / replaced by ->"
```
