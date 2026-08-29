# tabby-projects

Work on all your projects from one Tabby window.

- **Project rail** down the left — grouped, coloured, with icons and a dot for anything that's open.
- **Per-project tabs** along the top — each project is one Tabby tab with its own strip of terminals (say *Claude*, *Shell*, *Dev server*) and a **Files** browser.
- **One click** opens a project: connects to its host (local shell or SSH), `cd`s into the working directory and runs each tab's command.
- **Remote file browser** for SSH projects — Tabby's own SFTP panel, docked as a tab.
- **Edit-in-place** — double-click a remote file: it's downloaded to a temp folder, opened in your editor, and uploaded again every time you save. Per-extension *Open with* overrides (e.g. `.md` → your Markdown editor).
- **Icons** — a built-in stroke set, any Font Awesome 5 class, pasted SVG, or an uploaded image.
- **Pinned / More** — pinned projects are always listed; unpin the rest and they fold into a *More (n)* row per group. Anything open is always shown.
- **Needs-attention badge** — when a tab you're not looking at rings the terminal bell, it (and its project in the rail) gets a pulsing amber dot, plus an optional desktop notification that jumps straight to it. Claude Code rings the bell when it finishes or waits for input if you set `"preferredNotifChannel": "terminal_bell"` in `~/.claude/settings.json`.
- **Add from anywhere** — the rail's **+** turns any Tabby profile into a project; right-click any terminal tab → *Add to Projects* (keeps its profile and current directory).
- **Survives restarts** — projects and their tabs come back after a Tabby restart. A tab's command can use `{{session}}` (a per-tab UUID) and a separate *After restart* command; the Claude default is `claude --session-id {{session}}` / `claude --resume {{session}}`, so the same conversation reappears in the same tab — like the VS Code extension. (Remote tabs running under tmux simply re-attach.)

> Works with Tabby ≥ 1.0.200 (Angular 15 builds). Tested on 1.0.235 / Windows.

## Install

From Tabby: **Settings → Plugins**, search `projects`, install, restart Tabby.

Or from a checkout:

```bash
npm install --ignore-scripts
npm run build
npm run link:tabby     # symlinks this folder into Tabby's plugin directory
```

Restart Tabby. A **Projects** page appears in Settings, and the rail appears on the left.

## Setting up a project

Rail **+** (pick a profile), right-click a terminal tab → *Add to Projects*, or Settings → **Projects** → **+**

| Field | Meaning |
|---|---|
| Host profile | Any Tabby profile: a local shell (PowerShell, bash…) or an SSH profile. The project's tabs are opened *through* this profile. |
| Working directory | Where every tab starts (`cd` is sent for SSH; `cwd` is set for local shells). |
| Tabs | Each has a title, an icon, a kind (**Shell** or **Files**) and, for shells, an optional command to run once the prompt appears. *Auto* tabs open with the project. |
| Prompt pattern | Regex used to detect the shell prompt before typing the command (global default `[$#%>] $`; override per project for unusual prompts). |

For local PowerShell / cmd / bash the command is passed as a shell argument (`-NoExit -Command …`, `/k …`, `-c …`), so it doesn't depend on prompt detection.

### Tip: persistent remote sessions

Point a tab's command at `tmux new -A -s myproject` (or a tiny wrapper) and the session survives disconnects; reopening the project just re-attaches.

## Keyboard

Configure under Tabby's **Hotkeys → Projects**:

| Action | Default |
|---|---|
| Toggle / collapse rail | `Ctrl-B` |
| Quick open project | `Ctrl-Shift-O` |
| Next / previous tab in project | `Ctrl-Alt-PageDown` / `Ctrl-Alt-PageUp` |
| New tab in project | `Ctrl-Alt-N` |

## Configuration

Everything lives in Tabby's `config.yaml` under `projects:` — easy to script or sync.

```yaml
projects:
  showRail: true
  hideTabBar: true          # the rail replaces Tabby's tab bar; other tabs are listed under "Other tabs"
  railWidth: 240
  promptExpect: '[$#%>] $'
  openWith:
    md: C:\Program Files\Typora\Typora.exe
  groups:
    - { id: g1, name: Work, color: '#5da9f6' }
  items:
    - id: p1
      name: My API
      group: g1
      icon: fas fa-rocket
      profile: ssh:custom:dev-box:…     # id of an existing Tabby profile
      cwd: /srv/my-api
      tabs:
        - { id: t1, title: Claude, kind: shell, command: claude, autoOpen: true }
        - { id: t2, title: Shell,  kind: shell, autoOpen: true }
        - { id: t3, title: Files,  kind: files }
```

## How it works

- `ProjectTabComponent` is a regular Tabby tab that hosts child tabs (created through Tabby's own profile machinery) and shows one at a time behind its own strip. Child tabs are real terminal tabs, so splitting them out into a normal Tabby tab is one right-click away.
- The rail is created dynamically and slotted next to Tabby's main content (Tabby has no sidebar extension point). It reads Tabby's theme variables, so it follows your colour scheme.
- **Files** embeds `SFTPPanelComponent` from `tabby-ssh`, bound to the SSH session of a sibling terminal — no second connection.
- Edit-in-place mirrors files under `%TEMP%/tabby-projects/<host>/…`, watches the directory, and uploads through the same SFTP session (temp file + rename, like Tabby's own uploader).

## Development

```bash
npm run watch          # rebuild on change
npm run link:tabby     # once
```

Restart Tabby to pick up a new build. Plugin errors show in `Tabby → View → Toggle Developer Tools` and in Tabby's `log.txt`.

## License

MIT
