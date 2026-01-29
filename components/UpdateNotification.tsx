import React, { useState, useEffect } from 'react';
import { RefreshIcon, CloseIcon } from './Icons';

interface UpdateNotificationProps {
    onRefresh: () => void;
    onDismiss: () => void;
}

export const UpdateNotification: React.FC<UpdateNotificationProps> = ({ onRefresh, onDismiss }) => {
    return (
        <div className="fixed top-0 inset-x-0 z-[100] animate-fade-in">
            <div className="bg-gradient-to-r from-cyan-600 to-blue-600 text-white px-4 py-3 shadow-lg">
                <div className="max-w-7xl mx-auto flex items-center justify-between gap-4">
                    <div className="flex items-center gap-3">
                        <div className="flex-shrink-0 w-8 h-8 rounded-full bg-white/20 flex items-center justify-center">
                            <RefreshIcon className="w-4 h-4" />
                        </div>
                        <div>
                            <p className="font-semibold text-sm">New version available!</p>
                            <p className="text-xs text-white/80">Refresh to get the latest features and fixes.</p>
                        </div>
                    </div>
                    <div className="flex items-center gap-2">
                        <button
                            onClick={onRefresh}
                            className="px-4 py-2 bg-white text-cyan-700 font-bold text-sm rounded-lg hover:bg-white/90 transition-colors shadow-md"
                        >
                            Refresh Now
                        </button>
                        <button
                            onClick={onDismiss}
                            className="p-2 text-white/70 hover:text-white hover:bg-white/10 rounded-lg transition-colors"
                            title="Dismiss"
                        >
                            <CloseIcon className="w-4 h-4" />
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default UpdateNotification;
