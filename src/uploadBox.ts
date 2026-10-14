import { Injectable } from '@angular/core'
import { ConfigService, MenuItemOptions, NotificationsService, PlatformService } from 'tabby-core'
import type { DirectoryUpload, FileUpload } from 'tabby-core'
import { BaseTerminalTabComponent, TerminalDecorator } from 'tabby-terminal'
import * as path from 'path'
import { Project, ProjectsConfig } from './api'
import { UI } from './icons'
import { TransferService, fileUploadsIn, sshSessionOf } from './services/transfer.service'

type Item = FileUpload | DirectoryUpload
type Look = '' | 'busy' | 'ok' | 'err'

/**
 * A small "Upload" box in the top-right corner of every SSH terminal. Drop files or folders on it
 * (or click to pick them) and they go into the upload folder over the tab's own SFTP session, then
 * their remote paths are typed at the prompt — so Claude Code gets them just like a local drop.
 *
 * While files are dragged over the terminal the box grows into a proper drop target. Dropping
 * anywhere else in the terminal keeps Tabby's default (pasting the *local* path).
 */
@Injectable()
export class UploadBoxDecorator extends TerminalDecorator {
    private boxes = new Map<BaseTerminalTabComponent<any>, UploadBox>()

    constructor (
        public config: ConfigService,
        public platform: PlatformService,
        public notifications: NotificationsService,
        public transfers: TransferService,
    ) {
        super()
    }

    attach (tab: BaseTerminalTabComponent<any>): void {
        if (tab.profile?.type !== 'ssh' || !tab.element?.nativeElement) return
        injectStyle()
        const box = new UploadBox(tab, this)
        this.boxes.set(tab, box)
        this.subscribeUntilDetached(tab, this.config.changed$.subscribe(() => box.refresh()))
    }

    detach (tab: BaseTerminalTabComponent<any>): void {
        this.boxes.get(tab)?.destroy()
        this.boxes.delete(tab)
        super.detach(tab)
    }
}

class UploadBox {
    private host: HTMLElement
    private el = document.createElement('div')
    private icon: HTMLElement
    private label: HTMLElement
    private dest: HTMLElement
    private barFill: HTMLElement
    private busy = false
    private disarmTimer: any = null
    private resetTimer: any = null
    private progressTimer: any = null

    constructor (private tab: BaseTerminalTabComponent<any>, private ctx: UploadBoxDecorator) {
        this.host = tab.element.nativeElement
        this.el.className = 'tp-upbox'
        this.el.innerHTML = '<span class="tp-upbox-icon"></span><span class="tp-upbox-text"><span class="tp-upbox-label"></span><span class="tp-upbox-dest"></span></span><span class="tp-upbox-bar"><i></i></span>'
        this.icon = this.el.querySelector('.tp-upbox-icon')!
        this.label = this.el.querySelector('.tp-upbox-label')!
        this.dest = this.el.querySelector('.tp-upbox-dest')!
        this.barFill = this.el.querySelector('.tp-upbox-bar > i')!

        this.host.addEventListener('dragover', this.onHostDragOver)
        this.host.addEventListener('drop', this.disarm)
        this.el.addEventListener('dragover', this.onDragOver)
        this.el.addEventListener('dragleave', this.onDragLeave)
        this.el.addEventListener('drop', this.onDrop)
        this.el.addEventListener('click', this.onClick)
        this.el.addEventListener('contextmenu', this.onContextMenu)
        this.host.appendChild(this.el)
        this.refresh()
    }

    destroy (): void {
        this.host.removeEventListener('dragover', this.onHostDragOver)
        this.host.removeEventListener('drop', this.disarm)
        clearTimeout(this.disarmTimer)
        clearTimeout(this.resetTimer)
        clearInterval(this.progressTimer)
        this.el.remove()
    }

    /** Re-read config: on/off, and the folder shown. */
    refresh (): void {
        const on = this.cfg.uploadBox !== false
        this.el.classList.toggle('tp-off', !on)
        if (!on) this.disarm()
        if (!this.busy && !this.resetTimer) this.showIdle()
    }

    private get cfg (): ProjectsConfig {
        return this.ctx.config.store.projects
    }

    private project (): Project | null {
        return (this.tab.parent as any)?.project ?? null
    }

    private template (): string {
        return this.project()?.uploadDir?.trim() || this.cfg.uploadDir || '~/uploads'
    }

    /** Where files will land, for display (the home directory isn't resolved yet). */
    private where (): string {
        const dir = this.template().replace(/\{\{\s*cwd\s*\}\}/g, this.project()?.cwd || '~').replace(/\/+$/, '')
        return `${this.tab.profile?.options?.host ?? 'remote'}:${dir}/`
    }

    private showIdle (): void {
        this.setLook('', UI.upload, 'Upload')
        this.dest.textContent = this.where()
        this.el.title = `Drop files here to upload them to ${this.where()}\nClick to choose files · right-click for more`
    }

    private setLook (look: Look, icon: string, text: string): void {
        for (const l of ['busy', 'ok', 'err']) this.el.classList.toggle(`tp-${l}`, l === look)
        this.icon.innerHTML = icon
        this.label.textContent = text
    }

    // ---- drag and drop ---------------------------------------------------------

    /** Files dragged anywhere over the terminal: grow into a drop target until the drag leaves. */
    private onHostDragOver = (e: DragEvent): void => {
        if (!hasFiles(e) || this.busy || this.cfg.uploadBox === false) return
        if (!this.el.classList.contains('tp-armed')) {
            this.clearReset()
            this.showIdle()
            this.label.textContent = 'Drop here to upload'
            this.el.classList.add('tp-armed')
        }
        // dragover repeats while the drag is over us; when it stops, the drag has left.
        clearTimeout(this.disarmTimer)
        this.disarmTimer = setTimeout(this.disarm, 400)
    }

    private disarm = (): void => {
        clearTimeout(this.disarmTimer)
        if (!this.el.classList.contains('tp-armed')) return
        this.el.classList.remove('tp-armed', 'tp-over')
        if (!this.busy && !this.resetTimer) this.showIdle()
    }

    private onDragOver = (e: DragEvent): void => {
        if (!hasFiles(e)) return
        e.preventDefault()
        if (e.dataTransfer) e.dataTransfer.dropEffect = this.busy ? 'none' : 'copy'
        this.el.classList.add('tp-over')
    }

    private onDragLeave = (e: DragEvent): void => {
        if (!this.el.contains(e.relatedTarget as Node | null)) this.el.classList.remove('tp-over')
    }

    private onDrop = (e: DragEvent): void => {
        e.preventDefault()
        e.stopPropagation() // keep Tabby from also pasting the local path
        this.disarm()
        if (this.busy || !hasFiles(e)) return
        // Read the drop now: its dataTransfer is only readable while the event is dispatched.
        this.run(this.ctx.platform.startUploadFromDragEvent(e, true).then(root => root.getChildrens()))
    }

    // ---- click / menu ----------------------------------------------------------

    private onClick = (e: MouseEvent): void => {
        e.stopPropagation()
        if (!this.busy) this.pickFiles()
    }

    private onContextMenu = (e: MouseEvent): void => {
        e.preventDefault()
        e.stopPropagation()
        const cfg = this.cfg
        const items: MenuItemOptions[] = [
            { label: this.where(), enabled: false },
            { label: 'Upload files…', enabled: !this.busy, click: () => this.pickFiles() },
            { label: 'Upload a folder…', enabled: !this.busy, click: () => this.pickFolder() },
            { label: 'Copy folder path', click: () => this.copyFolderPath() },
            { type: 'separator' },
            {
                label: 'Type uploaded paths at the prompt',
                type: 'checkbox',
                checked: cfg.uploadInsertPath !== false,
                click: () => {
                    cfg.uploadInsertPath = cfg.uploadInsertPath === false
                    this.ctx.config.save()
                },
            },
            {
                label: 'Hide upload box',
                click: () => {
                    cfg.uploadBox = false
                    this.ctx.config.save()
                    this.ctx.notifications.notice('Upload box hidden. Turn it back on in Settings → Projects.')
                },
            },
        ]
        this.ctx.platform.popupContextMenu(items, e)
    }

    private pickFiles (): void {
        this.run(this.ctx.platform.startUpload({ multiple: true }))
    }

    private pickFolder (): void {
        this.run(this.ctx.platform.startUploadDirectory().then(root => root.getChildrens()))
    }

    private async copyFolderPath (): Promise<void> {
        let dir = this.where().replace(/^[^:]*:/, '')
        const session = sshSessionOf(this.tab)
        if (session) {
            try {
                dir = await this.ctx.transfers.uploadDirFor(session, await session.openSFTP(), this.template(), this.project()?.cwd ?? null) + '/'
            } catch { /* keep the unresolved form */ }
        }
        this.ctx.platform.setClipboard({ text: dir })
    }

    // ---- upload ----------------------------------------------------------------

    private async run (pick: Promise<Item[]>): Promise<void> {
        let items: Item[] = []
        try {
            items = await pick
            if (!items.length) return
            const session = sshSessionOf(this.tab)
            if (!session) throw new Error('this tab is not connected')
            this.busy = true
            this.clearReset()
            this.setLook('busy', UI.upload, 'Uploading…')
            this.trackProgress(items)
            const sftp = await session.openSFTP()
            const dir = await this.ctx.transfers.uploadDirFor(session, sftp, this.template(), this.project()?.cwd ?? null)
            const paths = await this.ctx.transfers.uploadInto(sftp, items, dir)
            this.finish('ok', UI.ok, paths.length === 1 ? `Uploaded ${path.posix.basename(paths[0])}` : `Uploaded ${paths.length} items`)
            this.el.title = paths.join('\n')
            if (this.cfg.uploadInsertPath !== false) this.typePaths(paths)
        } catch (e: any) {
            for (const t of fileUploadsIn(items)) {
                if (!t.isComplete() && !t.isCancelled()) t.cancel()
            }
            const msg = e?.message ?? String(e)
            this.finish('err', UI.x, 'Upload failed')
            this.el.title = msg
            this.ctx.notifications.error(`Upload failed: ${msg}`)
        }
    }

    private trackProgress (items: Item[]): void {
        const files = fileUploadsIn(items)
        const total = files.reduce((n, f) => n + f.getSize(), 0)
        const tick = (): void => {
            const sent = files.reduce((n, f) => n + f.getCompletedBytes(), 0)
            const pct = total ? Math.min(100, Math.floor(sent * 100 / total)) : 0
            this.label.textContent = `Uploading${files.length > 1 ? ` ${files.length} files` : ''} · ${pct}%`
            this.barFill.style.width = `${pct}%`
        }
        tick()
        this.progressTimer = setInterval(tick, 250)
    }

    private finish (look: Look, icon: string, text: string): void {
        this.busy = false
        clearInterval(this.progressTimer)
        this.barFill.style.width = '0'
        this.setLook(look, icon, text)
        this.clearReset()
        this.resetTimer = setTimeout(() => {
            this.resetTimer = null
            this.showIdle()
        }, 4000)
    }

    private clearReset (): void {
        clearTimeout(this.resetTimer)
        this.resetTimer = null
    }

    /** Type the uploaded paths at the prompt, like Tabby does for a local drop. */
    private typePaths (paths: string[]): void {
        let text = paths.map(shellQuote).join(' ') + ' '
        if (this.ctx.config.store.terminal?.bracketedPaste && this.tab.frontend?.supportsBracketedPaste()) {
            text = `\x1b[200~${text}\x1b[201~`
        }
        this.tab.sendInput(text)
        this.tab.frontend?.focus()
    }
}

function hasFiles (e: DragEvent): boolean {
    return !!e.dataTransfer && Array.from(e.dataTransfer.types).includes('Files')
}

/** POSIX-quote a remote path, leaving a leading `~/` unquoted so it still expands. */
function shellQuote (p: string): string {
    const home = p.startsWith('~/') ? '~/' : ''
    const rest = p.slice(home.length)
    return home + (/^[\w@%+=:,./-]+$/.test(rest) ? rest : `'${rest.replace(/'/g, `'\\''`)}'`)
}

const STYLE_ID = 'tabby-projects-upload-box'

function injectStyle (): void {
    if (document.getElementById(STYLE_ID)) return
    const style = document.createElement('style')
    style.id = STYLE_ID
    style.textContent = CSS
    document.head.appendChild(style)
}

// Sits just left of Tabby's toolbar wrench (right: 34px), under the toolbar itself (z-index 4).
// With the toolbar pinned there's no wrench, so it moves below the toolbar and right up to the scrollbar.
const CSS = `
.tp-upbox {
    position: absolute; top: 6px; right: 70px; z-index: 3;
    display: flex; align-items: center; gap: 7px; max-width: calc(100% - 100px);
    padding: 4px 10px; border-radius: 7px;
    border: 1px dashed var(--theme-fg-more-2, rgba(255,255,255,.4));
    background: var(--theme-bg-more, rgba(24,24,24,.9));
    color: var(--theme-fg-more, #ccc);
    font-size: 11.5px; line-height: 1.3; cursor: pointer; user-select: none;
    opacity: .5; overflow: hidden;
    transition: opacity .15s, background .15s, border-color .15s, box-shadow .15s, padding .15s;
}
.tp-upbox:hover { opacity: 1; }
.toolbar-pinned > .tp-upbox { top: 46px; right: 30px; }
.tp-upbox.tp-off { display: none; }
.tp-upbox-icon { display: inline-flex; flex: none; }
.tp-upbox-icon svg { width: 14px; height: 14px; }
.tp-upbox-text { display: flex; flex-direction: column; min-width: 0; }
.tp-upbox-label { white-space: nowrap; }
.tp-upbox-dest { display: none; font-family: monospace; font-size: 11px; opacity: .75; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.tp-upbox-bar { display: none; position: absolute; left: 8px; right: 8px; bottom: 2px; height: 2px; border-radius: 1px; background: rgba(127,127,127,.25); overflow: hidden; }
.tp-upbox-bar > i { display: block; width: 0; height: 100%; background: var(--theme-primary, #5da9f6); transition: width .2s; }

.tp-upbox.tp-armed { opacity: 1; padding: 16px 22px; gap: 12px; border-width: 2px; border-color: var(--theme-primary, #5da9f6); box-shadow: 0 8px 28px rgba(0,0,0,.5); }
.tp-upbox.tp-armed .tp-upbox-icon svg { width: 24px; height: 24px; }
.tp-upbox.tp-armed .tp-upbox-label { font-size: 13px; color: var(--theme-fg, #fff); }
.tp-upbox.tp-armed .tp-upbox-dest { display: block; }
.tp-upbox.tp-over { background: color-mix(in srgb, var(--theme-primary, #5da9f6) 28%, var(--theme-bg-more, #181818)); border-style: solid; }

.tp-upbox.tp-busy { opacity: 1; cursor: progress; }
.tp-upbox.tp-busy .tp-upbox-bar { display: block; }
.tp-upbox.tp-busy .tp-upbox-icon { animation: tp-upbox-pulse 1s ease-in-out infinite; }
.tp-upbox.tp-ok { opacity: 1; border-style: solid; border-color: #6cc070; color: #8fdc93; }
.tp-upbox.tp-err { opacity: 1; border-style: solid; border-color: #ff615a; color: #ff8a84; }
@keyframes tp-upbox-pulse { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-2px); opacity: .6; } }
`
