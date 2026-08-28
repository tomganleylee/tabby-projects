import { NgModule } from '@angular/core'
import { CommonModule } from '@angular/common'
import { FormsModule } from '@angular/forms'
import { ConfigProvider, HotkeyProvider, HotkeysService, TabRecoveryProvider, ToolbarButtonProvider } from 'tabby-core'
import { SettingsTabProvider } from 'tabby-settings'
import { SFTPContextMenuItemProvider } from 'tabby-ssh'

import { ProjectsConfigProvider } from './config'
import { FilesTabComponent } from './components/filesTab.component'
import { IconPickerComponent } from './components/iconPicker.component'
import { ProjIconComponent } from './components/projIcon.component'
import { ProjectTabComponent, ProjectsSettingsOpener } from './components/projectTab.component'
import { RailComponent } from './components/rail.component'
import { ProjectsSettingsComponent } from './components/settings.component'
import {
    FilesTabRecoveryProvider, ProjectTabRecoveryProvider, ProjectsHotkeyProvider, ProjectsSFTPContextMenu,
    ProjectsSettingsOpenerImpl, ProjectsSettingsTabProvider, ProjectsToolbarButtonProvider,
} from './providers'
import { ProjectOpenerService } from './services/opener.service'
import { RailService } from './services/rail.service'

@NgModule({
    imports: [CommonModule, FormsModule],
    providers: [
        { provide: ConfigProvider, useClass: ProjectsConfigProvider, multi: true },
        { provide: TabRecoveryProvider, useClass: ProjectTabRecoveryProvider, multi: true },
        { provide: TabRecoveryProvider, useClass: FilesTabRecoveryProvider, multi: true },
        { provide: SettingsTabProvider, useClass: ProjectsSettingsTabProvider, multi: true },
        { provide: HotkeyProvider, useClass: ProjectsHotkeyProvider, multi: true },
        { provide: ToolbarButtonProvider, useClass: ProjectsToolbarButtonProvider, multi: true },
        { provide: SFTPContextMenuItemProvider, useClass: ProjectsSFTPContextMenu, multi: true },
        { provide: ProjectsSettingsOpener, useClass: ProjectsSettingsOpenerImpl },
    ],
    declarations: [
        ProjIconComponent,
        IconPickerComponent,
        ProjectTabComponent,
        FilesTabComponent,
        RailComponent,
        ProjectsSettingsComponent,
    ],
})
export default class ProjectsModule {
    constructor (
        rail: RailService,
        opener: ProjectOpenerService,
        hotkeys: HotkeysService,
    ) {
        rail.start()
        hotkeys.hotkey$.subscribe(id => {
            switch (id) {
                case 'projects-toggle-rail': rail.toggle(); break
                case 'projects-quick-open': opener.quickOpen(); break
                case 'projects-next-tab': opener.activeProjectTab()?.selectRelative(1); break
                case 'projects-prev-tab': opener.activeProjectTab()?.selectRelative(-1); break
                case 'projects-new-tab': opener.activeProjectTab()?.addTabMenu(); break
            }
        })
    }
}

export * from './api'
export { ProjectsService } from './services/projects.service'
export { ProjectOpenerService } from './services/opener.service'
export { LocalEditService } from './services/localEdit.service'
export { ProjectTabComponent, FilesTabComponent }
