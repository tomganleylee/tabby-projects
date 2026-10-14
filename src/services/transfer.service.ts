import { Injectable } from '@angular/core'
import { MenuItemOptions, NotificationsService, PlatformService } from 'tabby-core'
import type { DirectoryUpload, FileDownload, FileTransfer, FileUpload } from 'tabby-core'
import type { SFTPFile, SFTPSession } from 'tabby-ssh'
import type { SSHSession } from 'tabby-ssh/typings/session/ssh'
import * as fs from 'fs'
import * as path from 'path'
import { LocalEditService } from './localEdit.service'

export type TransferVerb = 'download' | 'upload'

// Present in current Tabby builds but missing from the published 1.0.231 typings this builds against.
interface DirectoryDownload extends FileTransfer {
    setStatus (status: string): void
    setTotalSize (size: number): void
    setCompleted (completed: boolean): void
    createDirectory (relativePath: string): Promise<void>
    createFile (relativePath: string, mode: number, size: number): Promise<FileDownload>
}

// Never offer "Open" for these: a crafted [[download:…]] in terminal output must not be one click from running code.
const RISKY_EXT = new Set([
    'exe', 'msi', 'msix', 'appx', 'bat', 'cmd', 'com', 'scr', 'pif', 'cpl', 'msc', 'lnk', 'url', 'reg',
    'ps1', 'psm1', 'psd1', 'vbs', 'vbe', 'js', 'jse', 'wsf', 'wsh', 'hta', 'jar', 'application', 'gadget',
])

/**
 * Actions behind [[download:…]] / [[upload:…]] links in terminal output: a small menu at the
 * click, then Tabby's own save/open dialogs and transfer progress, over the tab's SSH session.
 */
@Injectable({ providedIn: 'root' })
export class TransferService {
    constructor (
        private platform: PlatformService,
        private notifications: NotificationsService,
        private localEdit: LocalEditService,
    ) { }

    /** `candidates` are alternative spellings of one path (a token split across rows may have lost a space). */
    async showMenu (verb: TransferVerb, candidates: string[], session: SSHSession | null, event: MouseEvent): Promise<void> {
        let items: MenuItemOptions[]
        try {
            if (!session) {
                if (verb === 'upload') {
                    this.notifications.notice('Upload links need an SSH tab. On this machine, just give Claude the file path.')
                    return
                }
                items = this.localDownloadItems(candidates)
            } else {
                const sftp = await session.openSFTP()
                items = verb === 'download'
                    ? await this.remoteDownloadItems(session, sftp, candidates)
                    : await this.remoteUploadItems(session, sftp, candidates)
            }
        } catch (e: any) {
            this.notifications.error(e?.message ?? String(e))
            return
        }
        if (items.length) this.platform.popupContextMenu(items, event)
    }

    // ---- download --------------------------------------------------------------

    private async remoteDownloadItems (session: SSHSession, sftp: SFTPSession, candidates: string[]): Promise<MenuItemOptions[]> {
        const file = await firstExisting(sftp, candidates)
        if (!file) throw new Error(`Not found on ${hostOf(session)}: ${candidates[0]}`)

        const items: MenuItemOptions[] = [{ label: `${hostOf(session)}:${file.fullPath}`, enabled: false }]
        if (file.isDirectory) {
            items.push({ label: 'Download folder…', click: () => this.downloadFolder(sftp, file) })
        } else {
            items.push({ label: 'Download…', click: () => this.downloadFile(sftp, file) })
            if (!isRisky(file.name)) {
                items.push({ label: 'Open', click: () => this.localEdit.editRemote(session, file) })
                const prog = this.localEdit.programFor(file.name)
                if (prog) items.push({ label: `Open with ${path.basename(prog)}`, click: () => this.localEdit.editRemote(session, file, prog) })
            }
        }
        items.push({ type: 'separator' }, { label: 'Copy path', click: () => this.platform.setClipboard({ text: file.fullPath }) })
        return items
    }

    private localDownloadItems (candidates: string[]): MenuItemOptions[] {
        const p = candidates.find(c => fs.existsSync(c))
        if (!p) throw new Error(`Not found on this machine: ${candidates[0]}`)
        const items: MenuItemOptions[] = [{ label: p, enabled: false }]
        if (!isRisky(p) && !fs.statSync(p).isDirectory()) items.push({ label: 'Open', click: () => this.platform.openPath(p) })
        items.push(
            { label: 'Show in folder', click: () => this.platform.showItemInFolder(p) },
            { type: 'separator' },
            { label: 'Copy path', click: () => this.platform.setClipboard({ text: p }) },
        )
        return items
    }

    private async downloadFile (sftp: SFTPSession, file: SFTPFile): Promise<void> {
        const transfer = await this.platform.startDownload(file.name, file.mode, file.size)
        if (!transfer) return
        try {
            await sftp.download(file.fullPath, transfer)
        } catch (e: any) {
            this.notifications.error(`Download failed: ${e?.message ?? e}`)
        }
    }

    // Mirrors Tabby's SFTPPanelComponent.downloadFolder.
    private async downloadFolder (sftp: SFTPSession, folder: SFTPFile): Promise<void> {
        const platform = this.platform as any
        if (typeof platform.startDownloadDirectory !== 'function') {
            this.notifications.error('Folder download needs a newer Tabby. Ask Claude to zip it instead.')
            return
        }
        const transfer: DirectoryDownload | null = await platform.startDownloadDirectory(folder.name, 0)
        if (!transfer) return
        try {
            await Promise.all([
                folderSize(sftp, folder, transfer),
                downloadTree(sftp, folder, transfer, ''),
            ])
            transfer.setStatus('')
            transfer.setCompleted(true)
        } catch (e: any) {
            transfer.cancel()
            this.notifications.error(`Download failed: ${e?.message ?? e}`)
        } finally {
            transfer.close()
        }
    }

    // ---- upload ----------------------------------------------------------------

    private async remoteUploadItems (session: SSHSession, sftp: SFTPSession, candidates: string[]): Promise<MenuItemOptions[]> {
        const existing = await firstExisting(sftp, candidates)
        const target = existing?.fullPath ?? candidates[0]
        // A trailing slash or an existing directory means "into this folder"; anything else is the exact destination file.
        const intoDir = existing ? existing.isDirectory : target.endsWith('/')
        const items: MenuItemOptions[] = [{ label: `${hostOf(session)}:${target}`, enabled: false }]
        if (intoDir) {
            items.push(
                { label: 'Upload files here…', click: () => this.uploadFiles(session, sftp, target, true) },
                { label: 'Upload a folder here…', click: () => this.uploadFolder(session, sftp, target) },
            )
        } else {
            items.push({ label: `Upload a file as ${path.posix.basename(target)}…`, click: () => this.uploadFiles(session, sftp, target, false) })
        }
        items.push({ type: 'separator' }, { label: 'Copy path', click: () => this.platform.setClipboard({ text: target }) })
        return items
    }

    private async uploadFiles (session: SSHSession, sftp: SFTPSession, target: string, intoDir: boolean): Promise<void> {
        const transfers = await this.platform.startUpload({ multiple: intoDir })
        if (!transfers.length) return
        const done: string[] = []
        try {
            await mkdirp(sftp, intoDir ? target : path.posix.dirname(target))
            for (const t of transfers) {
                const dest = intoDir ? path.posix.join(target, t.getName()) : target
                if (await exists(sftp, dest) && !await this.confirmOverwrite(session, dest)) {
                    t.cancel()
                    continue
                }
                await sftp.upload(dest, t)
                done.push(dest)
            }
        } catch (e: any) {
            transfers.forEach(t => t.isComplete() || t.cancel())
            this.notifications.error(`Upload failed: ${e?.message ?? e}`)
        }
        if (done.length) {
            const what = done.length === 1 ? done[0] : `${done.length} files → ${target}`
            this.notifications.info(`Uploaded to ${hostOf(session)}: ${what}`)
        }
    }

    // Mirrors Tabby's SFTPPanelComponent.uploadOneFolder.
    private async uploadFolder (session: SSHSession, sftp: SFTPSession, target: string): Promise<void> {
        const root = await this.platform.startUploadDirectory()
        if (!root.getChildrens().length) return
        try {
            await mkdirp(sftp, target)
            await uploadTree(sftp, root, target)
            this.notifications.info(`Uploaded to ${hostOf(session)}: ${target}`)
        } catch (e: any) {
            this.notifications.error(`Upload failed: ${e?.message ?? e}`)
        }
    }

    // ---- upload box ------------------------------------------------------------

    /**
     * The upload box's folder: `{{cwd}}` → the project's working directory; `~` and relative
     * paths are home-relative (as SFTP resolves them). Stays `~/…` if the home can't be found.
     */
    async uploadDirFor (session: SSHSession, sftp: SFTPSession, template: string, cwd: string | null): Promise<string> {
        let dir = (template.trim() || '~/uploads').replace(/\{\{\s*cwd\s*\}\}/g, cwd || '~')
        if (!dir.startsWith('/')) {
            const rel = dir.replace(/^~\/?/, '')
            const home = await this.homeOf(session, sftp)
            dir = home ? path.posix.join(home, rel) : `~/${rel}`
        }
        return dir.length > 1 ? dir.replace(/\/+$/, '') : dir
    }

    /**
     * Upload dropped or picked items into `dir` (created if missing). Never overwrites: a taken
     * name gets a number (`shot.png` → `shot-1.png`). Returns the remote path of each item.
     */
    async uploadInto (sftp: SFTPSession, items: (FileUpload | DirectoryUpload)[], dir: string): Promise<string[]> {
        // `~/x` (home not found) is just `x` to SFTP, which resolves relative paths against the home.
        const remote = (p: string): string => p === '~' ? '.' : p.startsWith('~/') ? p.slice(2) || '.' : p
        await mkdirp(sftp, remote(dir))
        const done: string[] = []
        for (const item of items) {
            const dest = await freeName(sftp, dir, item.getName(), remote)
            if (isDirectoryUpload(item)) {
                await sftp.mkdir(remote(dest))
                await uploadTree(sftp, item, remote(dest))
            } else {
                await sftp.upload(remote(dest), item)
            }
            done.push(dest)
        }
        return done
    }

    private homes = new WeakMap<SSHSession, string | null>()

    /** SFTP here has no realpath, so find the login user's home by trying the usual places. */
    private async homeOf (session: SSHSession, sftp: SFTPSession): Promise<string | null> {
        if (this.homes.has(session)) return this.homes.get(session)!
        const user: string = (session as any).authUsername || session.profile?.options?.user || ''
        const candidates = !user ? [] : user === 'root' ? ['/root'] : [`/home/${user}`, `/Users/${user}`, `/var/home/${user}`]
        let home: string | null = null
        for (const c of candidates) {
            try {
                if ((await sftp.stat(c)).isDirectory) { home = c; break }
            } catch { /* try the next one */ }
        }
        this.homes.set(session, home)
        return home
    }

    private async confirmOverwrite (session: SSHSession, dest: string): Promise<boolean> {
        const r = await this.platform.showMessageBox({
            type: 'warning',
            message: `Replace ${path.posix.basename(dest)}?`,
            detail: `${hostOf(session)}:${dest} already exists.`,
            buttons: ['Replace', 'Skip'],
            defaultId: 1,
            cancelId: 1,
        })
        return r.response === 0
    }
}

function hostOf (session: SSHSession): string {
    return session.profile?.name || session.profile?.options?.host || 'remote'
}

/** The terminal tab's SSH session, if it is an SSH tab that has connected. */
export function sshSessionOf (tab: any): SSHSession | null {
    const s = tab?.sshSession
    return s && typeof s.openSFTP === 'function' ? s : null
}

/** Every file in a set of picked/dropped items, folders included. */
export function fileUploadsIn (items: (FileUpload | DirectoryUpload)[]): FileUpload[] {
    return items.flatMap(i => isDirectoryUpload(i) ? fileUploadsIn(i.getChildrens()) : [i])
}

function isDirectoryUpload (item: FileUpload | DirectoryUpload): item is DirectoryUpload {
    return typeof (item as any).getChildrens === 'function'
}

/** `dir/name`, or `dir/stem-1.ext`, `-2`… when that's taken (`.tar.gz` stays together). */
async function freeName (sftp: SFTPSession, dir: string, name: string, remote: (p: string) => string): Promise<string> {
    let ext = path.posix.extname(name)
    if (ext && name.slice(0, -ext.length).endsWith('.tar')) ext = '.tar' + ext
    const stem = name.slice(0, name.length - ext.length)
    for (let i = 0; i < 1000; i++) {
        const p = path.posix.join(dir, i ? `${stem}-${i}${ext}` : name)
        if (!await exists(sftp, remote(p))) return p
    }
    throw new Error(`Too many files called ${name} in ${dir}`)
}

function isRisky (name: string): boolean {
    return RISKY_EXT.has(path.extname(name).slice(1).toLowerCase())
}

async function exists (sftp: SFTPSession, p: string): Promise<boolean> {
    try { await sftp.stat(p); return true } catch { return false }
}

async function firstExisting (sftp: SFTPSession, candidates: string[]): Promise<SFTPFile | null> {
    for (const c of candidates) {
        try { return await sftp.stat(c.length > 1 ? c.replace(/\/+$/, '') : c) } catch { /* try the next spelling */ }
    }
    return null
}

async function mkdirp (sftp: SFTPSession, dir: string): Promise<void> {
    const parts = dir.split('/').filter(Boolean)
    let p = dir.startsWith('/') ? '' : '.'
    for (const part of parts) {
        p = `${p}/${part}`
        if (!await exists(sftp, p)) await sftp.mkdir(p)
    }
}

async function folderSize (sftp: SFTPSession, folder: SFTPFile, transfer: DirectoryDownload, acc = { total: 0 }): Promise<number> {
    for (const item of await sftp.readdir(folder.fullPath)) {
        if (item.isDirectory) {
            await folderSize(sftp, item, transfer, acc)
        } else {
            acc.total += item.size
        }
        transfer.setTotalSize(acc.total)
    }
    return acc.total
}

async function downloadTree (sftp: SFTPSession, folder: SFTPFile, transfer: DirectoryDownload, rel: string): Promise<void> {
    for (const item of await sftp.readdir(folder.fullPath)) {
        if (transfer.isCancelled()) throw new Error('Download cancelled')
        const itemRel = rel ? `${rel}/${item.name}` : item.name
        transfer.setStatus(itemRel)
        if (item.isDirectory) {
            await transfer.createDirectory(itemRel)
            await downloadTree(sftp, item, transfer, itemRel)
        } else {
            await sftp.download(item.fullPath, await transfer.createFile(itemRel, item.mode, item.size))
        }
    }
}

async function uploadTree (sftp: SFTPSession, dir: DirectoryUpload, remote: string): Promise<void> {
    for (const child of dir.getChildrens()) {
        if (typeof (child as any).getChildrens === 'function') {
            const sub = path.posix.join(remote, child.getName())
            if (!await exists(sftp, sub)) await sftp.mkdir(sub)
            await uploadTree(sftp, child as DirectoryUpload, sub)
        } else {
            await sftp.upload(path.posix.join(remote, child.getName()), child as FileUpload)
        }
    }
}
