/** Public types for the tabby-projects plugin. Persisted under `projects:` in Tabby's config.yaml. */

export type ProjectTabKind = 'shell' | 'files'

export interface ProjectTabSpec {
    id: string
    title: string
    kind: ProjectTabKind
    /** Optional icon override (`fas fa-…`, or raw `<svg>`/`<img>` markup). */
    icon?: string | null
    /** For `shell` tabs: command to run once the shell is up (e.g. `claude`, `npm run dev`). */
    command?: string | null
    /** Open this tab automatically when the project is opened. */
    autoOpen?: boolean
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
    groups: ProjectGroup[]
    items: Project[]
}

export const PROJECT_TAB_TOKEN_TYPE = 'app:tabby-projects'
export const FILES_TAB_TOKEN_TYPE = 'app:tabby-projects-files'

export function uid (): string {
    return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4)
}
