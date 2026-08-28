import { Injectable } from '@angular/core'
import { ConfigService, NotificationsService, PlatformService } from 'tabby-core'
import type { SFTPFile, SFTPSession } from 'tabby-ssh'
import type { SSHSession } from 'tabby-ssh/typings/session/ssh'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { spawn } from 'child_process'

let russh: any = null
try { russh = require('russh') } catch { /* fall back to SFTP protocol constants below */ }
const OPEN_READ: number = russh?.OPEN_READ ?? 0x01
const OPEN_WRITE: number = russh?.OPEN_WRITE ?? 0x02
const OPEN_CREATE: number = russh?.OPEN_CREATE ?? 0x08

interface Watched {
    watcher: fs.FSWatcher
    timer: NodeJS.Timeout | null
    lastHash: string
    busy: boolean
}

/**
 * Edit-in-place for remote files: download to a temp mirror, open with the OS default
 * (or a configured "open with" program), watch the local copy and upload on every save.
 */
@Injectable({ providedIn: 'root' })
export class LocalEditService {
    private watched = new Map<string, Watched>()

    constructor (
        private platform: PlatformService,
        private notifications: NotificationsService,
        private config: ConfigService,
    ) { }

    programFor (fileName: string): string | null {
        const ext = path.extname(fileName).slice(1).toLowerCase()
        const map: Record<string, string> = this.config.store.projects?.openWith ?? {}
        return map[ext] || null
    }

    localPathFor (session: SSHSession, remotePath: string): string {
        const host = (session.profile?.options?.host ?? 'remote').replace(/[^a-z0-9.\-_]/gi, '_')
        return path.join(os.tmpdir(), 'tabby-projects', host, ...remotePath.split('/').filter(Boolean))
    }

    async editRemote (session: SSHSession, file: SFTPFile, program?: string | null): Promise<void> {
        if (file.isDirectory) return
        const sftp = await session.openSFTP()
        const local = this.localPathFor(session, file.fullPath)
        fs.mkdirSync(path.dirname(local), { recursive: true })

        try {
            const data = await readAll(sftp, file.fullPath)
            fs.writeFileSync(local, data)
        } catch (e: any) {
            this.notifications.error(`Download failed: ${e?.message ?? e}`)
            return
        }

        const prog = program ?? this.programFor(file.name)
        if (prog) {
            try {
                spawn(prog, [local], { detached: true, stdio: 'ignore', windowsHide: false }).unref()
            } catch (e: any) {
                this.notifications.error(`Could not start ${prog}: ${e?.message ?? e}`)
                return
            }
        } else {
            this.platform.openPath(local)
        }

        this.watch(local, async () => {
            const buf = fs.readFileSync(local)
            await writeAll(sftp, file.fullPath, buf, file.mode)
            this.notifications.info(`Saved ${file.name} → ${session.profile?.options?.host ?? 'remote'}`)
        })
        session.willDestroy$.subscribe(() => this.unwatch(local))
    }

    private watch (local: string, onSave: () => Promise<void>): void {
        this.unwatch(local)
        const dir = path.dirname(local)
        const name = path.basename(local)
        const entry: Watched = { watcher: null as any, timer: null, lastHash: hashOf(fs.readFileSync(local)), busy: false }
        // Watch the directory: editors that save via rename would otherwise detach a file watcher.
        entry.watcher = fs.watch(dir, (_event, changed) => {
            if (changed && changed !== name) return
            if (entry.timer) clearTimeout(entry.timer)
            entry.timer = setTimeout(async () => {
                entry.timer = null
                if (entry.busy || !fs.existsSync(local)) return
                const h = hashOf(fs.readFileSync(local))
                if (h === entry.lastHash) return
                entry.busy = true
                try {
                    await onSave()
                    entry.lastHash = h
                } catch (e: any) {
                    this.notifications.error(`Upload failed: ${e?.message ?? e}`)
                } finally {
                    entry.busy = false
                }
            }, 400)
        })
        this.watched.set(local, entry)
    }

    unwatch (local: string): void {
        const w = this.watched.get(local)
        if (!w) return
        if (w.timer) clearTimeout(w.timer)
        w.watcher.close()
        this.watched.delete(local)
    }
}

async function readAll (sftp: SFTPSession, remotePath: string): Promise<Buffer> {
    const handle = await sftp.open(remotePath, OPEN_READ)
    const chunks: Uint8Array[] = []
    try {
        while (true) {
            const chunk = await handle.read()
            if (!chunk.length) break
            chunks.push(chunk)
        }
    } finally {
        await handle.close()
    }
    return Buffer.concat(chunks)
}

async function writeAll (sftp: SFTPSession, remotePath: string, data: Buffer, mode: number): Promise<void> {
    // Write to a sibling temp file then rename over the original (same strategy as Tabby's uploader).
    const tmp = remotePath + '.tabby-projects-tmp'
    const handle = await sftp.open(tmp, OPEN_WRITE | OPEN_CREATE)
    try {
        const CHUNK = 32 * 1024
        for (let i = 0; i < data.length; i += CHUNK) {
            await handle.write(data.subarray(i, Math.min(i + CHUNK, data.length)))
        }
        if (!data.length) await handle.write(new Uint8Array(0))
    } finally {
        await handle.close()
    }
    try { await sftp.unlink(remotePath) } catch { /* may not exist */ }
    await sftp.rename(tmp, remotePath)
    if (mode) {
        try { await sftp.chmod(remotePath, mode & 0o777) } catch { /* best effort */ }
    }
}

function hashOf (buf: Buffer): string {
    // FNV-1a; plenty for change detection on a single file.
    let h = 0x811c9dc5
    for (let i = 0; i < buf.length; i++) {
        h ^= buf[i]
        h = Math.imul(h, 0x01000193) >>> 0
    }
    return `${buf.length}:${h.toString(16)}`
}
