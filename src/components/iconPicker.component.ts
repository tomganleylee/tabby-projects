import { Component, EventEmitter, Input, Output } from '@angular/core'
import { BUILTIN_ICONS } from '../icons'

const FA_SUGGESTIONS = [
    'fas fa-folder', 'fas fa-code', 'fas fa-server', 'fas fa-database', 'fas fa-cloud', 'fas fa-globe',
    'fas fa-terminal', 'fas fa-robot', 'fas fa-rocket', 'fas fa-bolt', 'fas fa-cube', 'fas fa-cubes',
    'fas fa-gamepad', 'fas fa-home', 'fas fa-users', 'fas fa-building', 'fas fa-chart-line', 'fas fa-shopping-cart',
    'fas fa-envelope', 'fas fa-camera', 'fas fa-music', 'fas fa-book', 'fas fa-flask', 'fas fa-bug',
    'fab fa-github', 'fab fa-docker', 'fab fa-python', 'fab fa-js', 'fab fa-react', 'fab fa-node-js', 'fab fa-linux', 'fab fa-windows',
]

/** Icon chooser: built-in stroke set, any Font Awesome class, pasted SVG, or an uploaded image. */
@Component({
    selector: 'icon-picker',
    template: `
        <div class="ip">
            <div class="ip-tabs">
                <button *ngFor="let m of modes" [class.active]="mode === m" (click)="mode = m">{{ m }}</button>
                <span class="ip-preview"><proj-icon [icon]="value" [color]="color"></proj-icon></span>
            </div>

            <div class="ip-grid" *ngIf="mode === 'Built-in'">
                <button class="ip-cell" *ngFor="let i of builtin" [class.active]="value === i.svg" (click)="set(i.svg)" [title]="i.name">
                    <proj-icon [icon]="i.svg"></proj-icon>
                </button>
            </div>

            <div *ngIf="mode === 'Font Awesome'">
                <input class="form-control form-control-sm" placeholder="fas fa-rocket" [ngModel]="isFA ? value : ''" (ngModelChange)="set($event)">
                <div class="ip-grid ip-grid-fa">
                    <button class="ip-cell" *ngFor="let c of fa" [class.active]="value === c" (click)="set(c)" [title]="c"><i class="fa-fw {{ c }}"></i></button>
                </div>
                <div class="ip-hint">Any Font Awesome 5 Free class works.</div>
            </div>

            <div *ngIf="mode === 'SVG'">
                <textarea class="form-control form-control-sm" rows="4" placeholder="<svg viewBox=&quot;0 0 24 24&quot;>…</svg>" [ngModel]="isSvg ? value : ''" (ngModelChange)="set($event)"></textarea>
                <div class="ip-hint">Paste SVG markup. Use <code>currentColor</code> to follow the project colour.</div>
            </div>

            <div *ngIf="mode === 'Image'">
                <input type="file" accept="image/*" (change)="onFile($event)">
                <div class="ip-hint">PNG / JPG / SVG file, stored inline (keep it small).</div>
            </div>
        </div>
    `,
    styles: [`
        .ip-tabs { display: flex; gap: 4px; align-items: center; margin-bottom: 8px; }
        .ip-tabs button { border: none; background: transparent; color: var(--theme-fg-more-2); font-size: 12px; padding: 4px 8px; border-radius: 4px; cursor: pointer; }
        .ip-tabs button.active { background: var(--theme-bg-more-2); color: var(--theme-fg); }
        .ip-preview { margin-left: auto; font-size: 22px; display: inline-flex; padding: 4px 8px; }
        .ip-grid { display: grid; grid-template-columns: repeat(auto-fill, 34px); gap: 6px; }
        .ip-grid-fa { margin-top: 8px; }
        .ip-cell { width: 34px; height: 34px; border: 1px solid transparent; border-radius: 5px; background: var(--theme-bg-more-2); color: var(--theme-fg-more); display: inline-flex; align-items: center; justify-content: center; font-size: 16px; cursor: pointer; }
        .ip-cell:hover { color: var(--theme-fg); border-color: var(--theme-fg-more-2); }
        .ip-cell.active { background: var(--bs-primary, #5da9f6); color: #000; }
        .ip-hint { font-size: 12px; color: var(--theme-fg-more-2); margin-top: 6px; }
    `],
})
export class IconPickerComponent {
    @Input() value: string | null = null
    @Input() color: string | null = null
    @Output() valueChange = new EventEmitter<string | null>()

    modes = ['Built-in', 'Font Awesome', 'SVG', 'Image']
    mode = 'Built-in'
    builtin = BUILTIN_ICONS
    fa = FA_SUGGESTIONS

    get isFA (): boolean { return !!this.value && !this.value.trim().startsWith('<') }
    get isSvg (): boolean { return !!this.value && this.value.trim().startsWith('<svg') }

    set (v: string | null): void {
        this.value = v?.trim() || null
        this.valueChange.emit(this.value)
    }

    onFile (event: Event): void {
        const file = (event.target as HTMLInputElement).files?.[0]
        if (!file) return
        const reader = new FileReader()
        reader.onload = () => this.set(`<img src="${reader.result}" style="width:1em;height:1em;object-fit:contain">`)
        reader.readAsDataURL(file)
    }
}
