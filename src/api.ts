/** Public types for the tabby-projects plugin. Persisted under `projects:` in Tabby's config.yaml. */

export type ProjectTabKind = 'shell' | 'files'

export interface ProjectTabSpec {
    id: string
    title: string
    kind: ProjectTabKind
    /** Optional icon override (`fas fa-…`, or raw `<svg>`/`<img>` markup). */
    icon?: string | null
    /**
     * For `shell` tabs: command to run once the shell is up (e.g. `claude`, `npm run dev`).
     * `{{session}}` expands to a UUID unique to this tab instance; `{{sid}}` to its first 8 chars
     * (handy for tmux session names).
     */
    command?: string | null
    /**
     * Command used instead of `command` when the tab is recovered after a Tabby restart,
     * e.g. `claude --resume {{session}}` — the same UUID the tab was launched with.
     */
    recoverCommand?: string | null
    /** Open this tab automatically when the project is opened. */
    autoOpen?: boolean
    /**
     * Let the program running in the tab set the tab's name (terminal title). Claude Code
     * publishes its conversation summary this way. Default: on when the command runs `claude`.
     */
    dynamicTitle?: boolean
}

export interface ProjectGroup {
    id: string
    name: string
    color?: string | null
    collapsed?: boolean
}

export interface Project {
    id: string
    name: string
    group?: string | null
    icon?: string | null
    color?: string | null
    /** ID of the Tabby profile (local or SSH) this project runs on. */
    profile: string | null
    /** Working directory on that host. */
    cwd?: string | null
    /** Regex matched against terminal output to know the shell is ready before sending `command`. */
    promptExpect?: string | null
    /** Pinned projects are always listed; unpinned ones fold into a "More" row in their group. Default true. */
    pinned?: boolean
    /** Where the upload box puts files for this project (blank = the global `uploadDir`). */
    uploadDir?: string | null
    tabs: ProjectTabSpec[]
}

export interface ProjectsConfig {
    showRail: boolean
    hideTabBar: boolean
    railWidth: number
    collapsed: boolean
    /** Default prompt regex for shells (a project can override). */
    promptExpect: string
    /** Extension (no dot, lower-case) → program path used by "Open with" for remote files. */
    openWith: Record<string, string>
    /** Show an OS notification when a tab you're not looking at rings the terminal bell. */
    notifyOnBell: boolean
    /** `[[download:/path]]` / `[[upload:/dir/]]` in terminal output become clickable. */
    transferLinks: boolean
    /** Show the drag-and-drop upload box in the top-right corner of SSH terminals. */
    uploadBox: boolean
    /** Remote folder the upload box uploads into. `~` = home, `{{cwd}}` = the project's working directory. */
    uploadDir: string
    /** After an upload-box upload, type the remote path(s) at the prompt (so Claude Code sees them). */
    uploadInsertPath: boolean
    groups: ProjectGroup[]
    items: Project[]
}

export const PROJECT_TAB_TOKEN_TYPE = 'app:tabby-projects'
export const FILES_TAB_TOKEN_TYPE = 'app:tabby-projects-files'

export function uid (): string {
    return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4)
}
