
import React from 'react';

export interface StatCardItem {
    name: string;
    value: string;
    subtext?: string;
    color?: string;
}

// Stat card component
export const StatCard: React.FC<{
    title: string;
    items: StatCardItem[];
    emptyText?: string;
}> = ({ title, items, emptyText = 'Not enough data' }) => (
    <div className="bg-zinc-800 rounded-xl border border-white/5 p-3 sm:p-4">
        <h4 className="text-[10px] sm:text-xs font-bold text-zinc-500 uppercase tracking-wider mb-2 sm:mb-3">{title}</h4>
        {items.length > 0 ? (
            <div className="space-y-2">
                {items.map((item, i) => (
                    <div key={i} className="flex items-center justify-between">
                        <span className="text-sm text-zinc-300 truncate pr-2">{item.name}</span>
                        <div className="text-right">
                            <span className={`text-sm font-bold ${item.color || 'text-white'}`}>{item.value}</span>
                            {item.subtext && <span className="text-[10px] text-zinc-500 ml-1">{item.subtext}</span>}
                        </div>
                    </div>
                ))}
            </div>
        ) : (
            <p className="text-xs text-zinc-600 italic">{emptyText}</p>
        )}
    </div>
);

export default StatCard;
