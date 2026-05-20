# Rebuild Bootstrap Kit

This folder contains everything needed to start a fresh, cleaner rebuild of the Archive.org Batch Metadata Editor in a new repo, using Claude Code (Sonnet) as the implementer.

## How to use

1. Create the new empty repo and import this kit:
   ```bash
   mkdir ~/code/archivebatcheditor-v2 && cd ~/code/archivebatcheditor-v2
   git init
   cp -r ~/code/archivebatcheditor/rebuild-bootstrap/* .
   git add . && git commit -m "Import rebuild bootstrap kit"
   ```
2. Run `claude` in that directory.
3. First message: *"Read CLAUDE.md, then ARCHITECTURE.md, then MILESTONES.md. Then start Milestone 0."*
4. As you progress, point Claude at LIFT_LIST.md and at the old repo (`/Users/allenhsieh/code/archivebatcheditor`) when it's time to port verbatim code.
5. Commit at each milestone boundary — those commits are your resume points.

## Resuming after a session token limit

A new session has no memory of the old one. Don't just say "start where we left off." Instead:

1. Commit any in-progress work (even WIP) in the previous session before it dies.
2. Start a fresh session in the same repo.
3. Open with: *"Read CLAUDE.md and MILESTONES.md. Run `git log --oneline -10` to see where I am. We finished Milestone X — continue with Milestone X+1."*
4. If you were mid-milestone when limits hit, also tell it which specific step in that milestone's checklist you were on.

The milestone structure was designed for exactly this. Each milestone is a clean handoff: the docs hold the constraints, git history shows what's done, and `LIFT_LIST.md` tells the new session what to copy from v1.

## Which Claude model to use

**Sonnet 4.6 is the right default for this build.**

- **Most of this is execution, not design.** The hard decisions (Next.js, SQLite, SSE contract, hard rules) are already locked in the docs. Sonnet is strong at typed TypeScript implementation work and is much cheaper, which matters across ~20 hours of build time.
- **Use Opus selectively** for the trickier milestones: M4 (SSE + partial-success), M6 (OAuth flow), M8 (retry queue + auth/quota abort logic). You can switch mid-session with `/model`.
- **Haiku** is too small for this — skip it.

The `MILESTONES.md` time estimates assume Sonnet. Running Opus everywhere will burn token limits ~3× faster for marginal quality gain on the easy milestones.

### About Claude Code's memory

Claude Code's auto-memory is scoped per-repo-directory — the new rebuild repo starts with an empty memory and won't inherit anything from this v1 repo's memory store at `~/.claude/projects/-Users-allenhsieh-code-archivebatcheditor/memory/`. That's by design: the rebuild's constraints are encoded in these `.md` files, which travel with the repo.

If a specific v1 memory is worth carrying forward (e.g., `feedback_preserve_archive_quirks.md`), copy its content into the appropriate `.md` doc in this folder before the rebuild starts. Don't rely on memory continuity across repos.

## What's in this folder

| File | Purpose | When to read |
|------|---------|--------------|
| `CLAUDE.md` | Hard rules, tech stack, commands. Loaded every session. | Always |
| `ARCHITECTURE.md` | Design decisions and the *why* behind each choice | When you need to understand a tradeoff |
| `MILESTONES.md` | Build plan, milestone by milestone | At the start, and between milestones |
| `DB_SCHEMA.md` | SQLite tables and drizzle schema | When working on persistence |
| `ARCHIVE_ORG_NOTES.md` | Archive.org API knowledge: endpoints, headers, error taxonomy, the date-format zoo | When touching Archive.org integration |
| `YOUTUBE_NOTES.md` | YouTube API knowledge: OAuth, quota, channel cache, retry queue | When touching YouTube integration |
| `LIFT_LIST.md` | Specific functions/files to copy verbatim from the old repo, with file:line refs | When implementing a feature whose v1 code is worth keeping |

## Why a rebuild instead of refactor

The current app works but has accumulated structural problems:

- `server/index.ts` is 2,592 lines (every route in one file)
- `MetadataEditor.tsx` is 2,705 lines (every UI section in one component)
- Persistence is scattered across `.youtube-tokens.json`, `.youtube-retry-queue.json`, `.youtube-channel-cache.json`, plus an unused `cache.db`
- Dual-server (Vite 3000 + Express 3001) creates real friction (OAuth callback redirect bugs, `FRONTEND_URL` workaround)
- Activity log is ephemeral — refresh wipes it, which is bad because **partial-success is the common case** and users need to revisit failed items later

The integration *behaviors* are all valuable and battle-tested. What needs to change is the structure around them.

## Non-goals (do not build)

- A general-purpose Archive.org file uploader. The user uses Archive.org's own uploader. The only upload flow in this app is "one flyer image fanned out as cover to N items."
- Multi-file / drag-drop / folder uploads.
- Old-version retention or undo for flyers.
- Multi-target atomic metadata writes (would break partial-success handling).
- Authentication / multi-user. Single-user, runs on localhost.
