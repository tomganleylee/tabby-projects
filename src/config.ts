import { ConfigProvider } from 'tabby-core'

export class ProjectsConfigProvider extends ConfigProvider {
    defaults = {
        projects: {
            showRail: true,
            hideTabBar: true,
            railWidth: 240,
            collapsed: false,
            // Matches the end of most shell prompts: `$ `, `# `, `> `, `% `.
            promptExpect: '[$#%>] $',
            openWith: {},
            groups: [],
            items: [],
        },
        hotkeys: {
            'projects-toggle-rail': ['Ctrl-B'],
            'projects-quick-open': ['Ctrl-Shift-O'],
            'projects-next-tab': ['Ctrl-Alt-PageDown'],
            'projects-prev-tab': ['Ctrl-Alt-PageUp'],
            'projects-new-tab': ['Ctrl-Alt-N'],
        },
    }

    platformDefaults = {}
}
