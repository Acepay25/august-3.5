import { JournalUIState } from '../hooks/useJournalUI';

export type AppHashView = 'chat' | 'journal' | 'market' | 'settings' | 'watch';

export interface AppHashRoute {
    view: AppHashView;
    tab?: JournalUIState['tab'];
}

export const parseAppHash = (hash: string): AppHashRoute => {
    const raw = (hash || '').replace(/^#/, '').replace(/^\//, '');
    const [head, rest] = raw.split('/');
    if (head === 'journal') {
        const tab = rest as JournalUIState['tab'] | undefined;
        const allowed: JournalUIState['tab'][] = ['log', 'performance', 'analytics', 'learning', 'memory', 'models', 'reasoning'];
        return { view: 'journal', tab: tab && allowed.includes(tab) ? tab : 'log' };
    }
    if (head === 'market') return { view: 'market' };
    if (head === 'settings') return { view: 'settings' };
    if (head === 'watch') return { view: 'watch' };
    return { view: 'chat' };
};

export const serializeAppHash = (route: AppHashRoute): string => {
    if (route.view === 'journal') return route.tab && route.tab !== 'log' ? `#/journal/${route.tab}` : '#/journal';
    if (route.view === 'market') return '#/market';
    if (route.view === 'settings') return '#/settings';
    if (route.view === 'watch') return '#/watch';
    return '#/';
};
