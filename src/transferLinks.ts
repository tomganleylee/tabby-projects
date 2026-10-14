import { Injectable } from '@angular/core'
import { ConfigService } from 'tabby-core'
import { BaseTerminalTabComponent, TerminalDecorator } from 'tabby-terminal'
import { TransferService, TransferVerb, sshSessionOf } from './services/transfer.service'

/**
 * Makes `[[download:/path]]` and `[[upload:/dir/]]` in terminal output clickable.
 *
 * Tabby's linkifier only keeps matches that parse as URLs, so this registers its own xterm
 * link provider. Claude Code (and tmux) hard-wrap long lines, so a token may span several
 * rows with the continuation indented: rows are joined, leading indent stripped, before matching.
 */
const TOKEN = /\[\[(download|upload):(\s*)([^[\]\r\n]{1,1024}?)\s*\]\]/g
const WINDOW = 4 // rows either side of the hovered row that a split token may reach into

interface Cell { row: number, col: number }

@Injectable()
export class TransferLinksDecorator extends TerminalDecorator {
    private providers = new Map<BaseTerminalTabComponent<any>, { dispose: () => void }>()

    constructor (
        private config: ConfigService,
        private transfers: TransferService,
    ) {
        super()
    }

    attach (tab: BaseTerminalTabComponent<any>): void {
        const xterm = (tab.frontend as any)?.xterm
        if (!xterm?.registerLinkProvider) return
        const provider = xterm.registerLinkProvider({
            provideLinks: (y: number, callback: (links: any[] | undefined) => void) => {
                if (this.config.store.projects?.transferLinks === false) return callback(undefined)
                const links = this.linksOnRow(tab, xterm, y - 1)
                callback(links.length ? links : undefined)
            },
        })
        this.providers.set(tab, provider)
    }

    detach (tab: BaseTerminalTabComponent<any>): void {
        this.providers.get(tab)?.dispose()
        this.providers.delete(tab)
        super.detach(tab)
    }

    private linksOnRow (tab: BaseTerminalTabComponent<any>, xterm: any, y: number): any[] {
        const buffer = xterm.buffer.active
        const cell = buffer.getNullCell()
        const first = Math.max(0, y - WINDOW)
        const last = Math.min(buffer.length - 1, y + WINDOW)

        let text = ''
        const at: Cell[] = []      // buffer cell of each char in `text`
        const joins: number[] = [] // indexes in `text` where a new row begins
        for (let r = first; r <= last; r++) {
            const line = buffer.getLine(r)
            if (!line) break
            const row = rowText(line, cell)
            let start = 0
            if (r > first) {
                joins.push(text.length)
                // A soft-wrapped row continues exactly; a hard-wrapped one carries indentation.
                if (!line.isWrapped) while (row.text[start] === ' ') start++
            }
            for (let i = start; i < row.text.length; i++) {
                text += row.text[i]
                at.push({ row: r, col: row.cols[i] })
            }
        }

        const links: any[] = []
        TOKEN.lastIndex = 0
        for (let m: RegExpExecArray | null; (m = TOKEN.exec(text));) {
            const s = at[m.index]
            const e = at[m.index + m[0].length - 1]
            if (s.row > y || e.row < y) continue
            const verb = m[1] as TransferVerb
            const pathStart = m.index + 2 + verb.length + 1 + m[2].length
            const candidates = spellings(m[3], joins.map(j => j - pathStart).filter(j => j > 0 && j < m![3].length))
            links.push({
                range: { start: { x: s.col + 1, y: s.row + 1 }, end: { x: e.col + 1, y: e.row + 1 } },
                text: m[0],
                decorations: { pointerCursor: true, underline: true },
                activate: (event: MouseEvent) => {
                    const modifier = this.config.store.clickableLinks?.modifier
                    if (modifier && !event[modifier]) return
                    this.transfers.showMenu(verb, candidates, sshSessionOf(tab), event)
                },
            })
        }
        return links
    }
}

/** Row text with a parallel column index per UTF-16 unit (wide chars occupy two cells). */
function rowText (line: any, cell: any): { text: string, cols: number[] } {
    let text = ''
    const cols: number[] = []
    for (let x = 0; x < line.length; x++) {
        line.getCell(x, cell)
        if (!cell.getWidth()) continue
        const ch = cell.getChars() || ' '
        for (let i = 0; i < ch.length; i++) {
            text += ch[i]
            cols.push(x)
        }
    }
    const trimmed = text.replace(/\s+$/, '')
    return { text: trimmed, cols: cols.slice(0, trimmed.length) }
}

/**
 * The path as matched, plus (if it was split across rows) the same path with a space at each
 * row break, since a wrap at a space loses it. `~` maps to the SFTP home (relative paths).
 */
function spellings (raw: string, breaks: number[]): string[] {
    const out = [raw.trim()]
    if (breaks.length) {
        let spaced = ''
        let prev = 0
        for (const b of breaks) {
            spaced += raw.slice(prev, b) + ' '
            prev = b
        }
        out.push((spaced + raw.slice(prev)).trim())
    }
    return [...new Set(out.map(p => p.replace(/^~(?=\/|$)/, '.')))]
}
