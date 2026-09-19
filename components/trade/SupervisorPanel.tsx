/**
 * SupervisorPanel — the Chart AI dock's overlay window onto the supervisor.
 *
 * The stream itself moved to `components/learn/SupervisorStream`, so the Learn
 * surface and this overlay read the same events from the same store instead of
 * the dock being the only place a user can watch the model govern itself. What
 * is left here is the backdrop and the sizing the dock needs.
 */

import React from 'react';
import SupervisorStream from '../learn/SupervisorStream';

export const SupervisorPanel: React.FC<{ onClose: () => void }> = ({ onClose }) => (
    <div className="absolute inset-0 z-40 flex items-start justify-center bg-black/50 px-6 pt-14 pb-6" data-testid="supervisor-panel">
        <div className="flex max-h-full w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-white/10 bg-zinc-950 shadow-xl">
            <SupervisorStream onClose={onClose} />
        </div>
    </div>
);

export default SupervisorPanel;
