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
