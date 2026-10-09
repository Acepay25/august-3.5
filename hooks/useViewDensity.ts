/**
 * The one view-density setting: Focus (only what you act on) vs Detail (the
 * telemetry too). Every reader and every writer goes through here, so no
 * surface can show a panel another surface says is resting.
 *
 * Alt+D in App.tsx is the keyboard writer; the resting notices on Learn and
 * Journal are the visible ones.
 */

import { useEffect, useState } from 'react';
import { getHarnessSettings, saveHarnessSettings, subscribeHarnessSettings } from '../utils/harnessSettings';

export type ViewDensity = 'focus' | 'detail';

export const useViewDensity = (): { density: ViewDensity; setDensity: (d: ViewDensity) => void } => {
    const [density, setDensity] = useState<ViewDensity>(() => getHarnessSettings().viewDensity);
    useEffect(() => subscribeHarnessSettings(next => setDensity(next.viewDensity)), []);
    const set = (next: ViewDensity): void => { saveHarnessSettings({ viewDensity: next }); };
    return { density, setDensity: set };
};
