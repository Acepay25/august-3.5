
import React, { useState, useEffect } from 'react';
import { StrategySearchResult } from '../../types';
import * as geminiService from '../../services/providers/geminiService';
import { CloseIcon, LoadingIcon, BotIcon, CheckIcon, LockIcon, ChevronDownIcon, SearchIcon, BrainIcon } from './Icons';
import { FAMILY_UI_DATA } from '../../constants/models';

interface StrategySearchProps {
  isVisible: boolean;
  onClose: () => void;
  onApplyStrategy: (strategyName: string) => void;
  onRemoveStrategy: (strategyName: string) => void;
  geminiModel: string;
  activeFrameworks: string[];
  defaultFrameworks: string[];
  initialViewStrategy?: string | null;
  onQuotaExceeded: (modelId: string) => void;
  familyWinRates: Record<string, { total: number; wins: number; winRate: number }>;
}

const isQuotaError = (error: any): boolean => {
  if (error && error.status === 429) return true;
  const message = (error?.message || '').toLowerCase();
  return message.includes('quota') || (message.includes('resource has been exhausted') && (message.includes('requests per minute') || message.includes('daily') || message.includes('monthly')));
};

const StrategySearch: React.FC<StrategySearchProps> = ({ 
    isVisible, 
    onClose, 
    onApplyStrategy,
    onRemoveStrategy,
    geminiModel,
    activeFrameworks,
    defaultFrameworks,
    initialViewStrategy,
    onQuotaExceeded,
    familyWinRates
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<StrategySearchResult[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isFrameworksVisible, setIsFrameworksVisible] = useState(true);
  const [isFamiliesVisible, setIsFamiliesVisible] = useState(false);
  const [viewingFramework, setViewingFramework] = useState<string | null>(null);
  const [frameworkDescription, setFrameworkDescription] = useState<string>('');
  const [isFetchingDescription, setIsFetchingDescription] = useState<boolean>(false);

  useEffect(() => {
    if (!isVisible) {
      setSearchQuery('');
      setSearchResults([]);
      setIsLoading(false);
      setError(null);
      setViewingFramework(null);
      setFrameworkDescription('');
      setIsFamiliesVisible(false); // Reset
    }
  }, [isVisible]);

  useEffect(() => {
    if (isVisible && initialViewStrategy) {
      setIsFrameworksVisible(true); 
      handleViewFrameworkDetails(initialViewStrategy);
    }
  }, [isVisible, initialViewStrategy]);

   const handleSearch = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!searchQuery.trim()) return;

    setIsLoading(true);
    setError(null);
    setSearchResults([]);
    try {
        const results = await geminiService.searchStrategies(searchQuery, activeFrameworks, geminiModel);
        setSearchResults(results);
        if (results.length === 0) {
            setError("No matching strategies found within your playbook.");
        }
    } catch (err: any) {
        if (isQuotaError(err)) {
            onQuotaExceeded(geminiModel);
            setError("Quota exceeded for the selected Gemini model.");
        } else {
            setError(err instanceof Error ? err.message : 'An unknown error occurred.');
        }
    } finally {
        setIsLoading(false);
    }
  };

  const handleDiscover = async () => {
    setIsLoading(true);
    setError(null);
    setSearchResults([]);
    setSearchQuery('');
    try {
        const results = await geminiService.discoverStrategies([], activeFrameworks, geminiModel);
        setSearchResults(results);
        if (results.length === 0) {
            setError("Could not discover any relevant strategies at this time.");
        }
    } catch (err: any) {
        if (isQuotaError(err)) {
            onQuotaExceeded(geminiModel);
            setError("Quota exceeded for the selected Gemini model.");
        } else {
            setError(err instanceof Error ? err.message : 'An unknown error occurred.');
        }
    } finally {
        setIsLoading(false);
    }
  };

  const handleViewFrameworkDetails = async (frameworkName: string) => {
    if (viewingFramework === frameworkName) {
        setViewingFramework(null);
        return;
    }
    setViewingFramework(frameworkName);
    setIsFetchingDescription(true);
    setFrameworkDescription('');
    try {
        const description = await geminiService.getStrategyDescription(frameworkName, geminiModel);
        setFrameworkDescription(description);
    } catch (err: any) {
        if (isQuotaError(err)) {
            onQuotaExceeded(geminiModel);
            setFrameworkDescription("Quota exceeded for the selected Gemini model. Please select a different model from the main view and try again.");
        } else if (err.status === 429 || (err.message && err.message.includes('Too Many Requests'))) {
            setFrameworkDescription("Rate limit exceeded. Please try again later.");
        } else {
            setFrameworkDescription(err instanceof Error ? err.message : 'Failed to load description.');
        }
    } finally {
        setIsFetchingDescription(false);
    }
  };

  const getFamilyColorClasses = (color: string) => {
      switch(color) {
          case 'red': return 'bg-red-500/10 border-red-500/30 text-red-400';
          case 'emerald': return 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400';
          case 'blue': return 'bg-blue-500/10 border-blue-500/30 text-blue-400';
          case 'purple': return 'bg-purple-500/10 border-purple-500/30 text-purple-400';
          default: return 'bg-zinc-800 border-zinc-600 text-zinc-300';
      }
  };

  return (
    <>
      <div 
        className={`fixed inset-0 bg-black/60 z-40 transition-opacity duration-300 ${isVisible ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
        onClick={onClose}
      ></div>

      <aside className={`fixed top-0 right-0 h-full w-full sm:w-[480px] bg-zinc-900/95 backdrop-blur-xl border-l border-white/10 shadow-2xl z-50 transform transition-transform duration-300 cubic-bezier(0.16, 1, 0.3, 1) flex flex-col ${isVisible ? 'translate-x-0' : 'translate-x-full'}`}>
        <div className="flex flex-col h-full">
          <header className="flex items-center justify-between p-4 sm:p-6 border-b border-white/5 bg-black/20">
            <h2 className="text-lg sm:text-xl font-bold text-cyan-400 tracking-tight">Playbook & Discovery</h2>
            <button onClick={onClose} className="p-2 sm:p-3 rounded-xl text-zinc-400 hover:bg-white/5 hover:text-white transition-colors">
              <CloseIcon className="w-5 h-5 sm:w-6 sm:h-6" />
            </button>
          </header>
          
          <div className="p-4 sm:p-6 border-b border-white/5 bg-zinc-900/50">
             <form onSubmit={handleSearch} className="flex gap-2 sm:gap-3 mb-3 sm:mb-5">
                <div className="relative flex-1">
                    <input
                        type="text"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        placeholder="Search..."
                        className="w-full bg-zinc-950 border border-white/10 rounded-xl pl-4 sm:pl-5 pr-10 sm:pr-12 py-3 sm:py-4 text-sm sm:text-base text-white focus:outline-none focus:ring-2 focus:ring-cyan-500/50 focus:border-cyan-500/50 transition-all"
                    />
                    <button
                        type="submit"
                        className="absolute right-2 top-1/2 -translate-y-1/2 p-2 rounded-lg text-zinc-400 hover:text-cyan-400 hover:bg-white/5 transition-colors"
                        disabled={isLoading || !searchQuery.trim()}
                    >
                        <SearchIcon className="w-4 h-4 sm:w-5 sm:h-5" />
                    </button>
                </div>
             </form>
             <button
                onClick={handleDiscover}
                disabled={isLoading}
                className="w-full flex items-center justify-center gap-2 sm:gap-3 bg-purple-600/20 hover:bg-purple-600/30 text-purple-300 border border-purple-500/30 font-bold py-3 sm:py-4 px-4 sm:px-5 rounded-xl transition-all disabled:opacity-50 disabled:cursor-not-allowed text-xs sm:text-base"
             >
                <BotIcon /> Auto-Discover Strategies
             </button>
             <p className="text-[10px] sm:text-xs text-zinc-600 text-center mt-2 sm:mt-4 font-medium">
                Use AI to research and add new frameworks from the web.
             </p>
          </div>

          <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-6 sm:space-y-10 pb-12">
            {isLoading && <div className="flex justify-center py-8"><LoadingIcon className="w-8 h-8 sm:w-10 sm:h-10 text-cyan-500" /></div>}
            {error && <div className="text-xs sm:text-sm text-red-300 p-4 sm:p-5 bg-red-500/10 rounded-xl border border-red-500/20">{error}</div>}
            
            {(searchResults || []).length > 0 && (
                <div className="space-y-3 sm:space-y-5">
                    <h3 className="text-xs sm:text-sm font-bold text-zinc-500 uppercase tracking-widest pl-1">Discovery Results</h3>
                    {(searchResults || []).map((result) => (
                        <div key={result.name} className="p-4 sm:p-6 bg-zinc-800/50 rounded-xl sm:rounded-2xl border border-white/5 hover:border-cyan-500/30 transition-colors animate-fade-in">
                           <div className="flex justify-between items-start mb-3 sm:mb-4">
                                <h4 className="font-bold text-cyan-400 text-lg sm:text-xl">{result.name}</h4>
                                <button 
                                    onClick={() => onApplyStrategy(result.name)}
                                    disabled={(activeFrameworks || []).some(fw => fw.toLowerCase() === result.name.toLowerCase())}
                                    className={`text-[10px] sm:text-xs font-bold uppercase tracking-wider py-2 px-4 rounded-lg transition-colors ${
                                        (activeFrameworks || []).some(fw => fw.toLowerCase() === result.name.toLowerCase())
                                        ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 cursor-default'
                                        : 'bg-cyan-600 text-white hover:bg-cyan-500 shadow-lg shadow-cyan-900/20'
                                    }`}
                                >
                                    {(activeFrameworks || []).some(fw => fw.toLowerCase() === result.name.toLowerCase()) ? 'Active' : 'Add'}
                                </button>
                           </div>
                           <p className="text-sm sm:text-base text-zinc-300 leading-relaxed">{result.description}</p>
                           {result.rationale && <div className="mt-3 sm:mt-4 pt-3 sm:pt-4 border-t border-white/5"><p className="text-xs sm:text-sm text-zinc-500 italic">Rationale: {result.rationale}</p></div>}
                        </div>
                    ))}
                </div>
            )}
            
            {/* Market Structure Families Section */}
            <div>
                <div 
                    onClick={() => setIsFamiliesVisible(!isFamiliesVisible)} 
                    className="flex justify-between items-center cursor-pointer py-3 sm:py-4 group"
                >
                    <h3 className="text-xs sm:text-sm font-bold text-zinc-500 uppercase tracking-widest group-hover:text-zinc-300 transition-colors flex items-center gap-2">
                        <BrainIcon className="w-4 h-4 sm:w-5 sm:h-5 text-cyan-600" />
                        Market Classification Families
                    </h3>
                    <ChevronDownIcon className={`w-4 h-4 sm:w-5 sm:h-5 text-zinc-600 transition-transform duration-200 ${isFamiliesVisible ? 'rotate-180' : ''}`} />
                </div>
                
                <div className={`collapsible-content ${isFamiliesVisible ? 'expanded' : ''}`}>
                    <div className="mt-2 sm:mt-4 space-y-3 sm:space-y-5">
                        <p className="text-xs sm:text-sm text-zinc-500 px-1">Pattern-recognition models used for probability forecasting.</p>
                        <div className="grid grid-cols-1 gap-3 sm:gap-5">
                            {FAMILY_UI_DATA.map(family => {
                                const stats = familyWinRates[family.name] || { total: 0, wins: 0, winRate: 0 };
                                return (
                                    <div key={family.id} className={`p-4 sm:p-6 rounded-xl sm:rounded-2xl border ${getFamilyColorClasses(family.color)} bg-opacity-10`}>
                                        <div className="flex justify-between items-start mb-2 sm:mb-4">
                                            <h4 className="font-black uppercase tracking-tight text-sm sm:text-base flex items-center gap-2">
                                                {family.name}
                                                {stats.total > 0 ? (
                                                    <span className={`text-[10px] sm:text-xs px-2 py-0.5 sm:px-2.5 sm:py-1 rounded-lg font-bold ${parseInt(String(stats.winRate)) > 50 ? 'bg-emerald-500/20 text-emerald-300' : 'bg-yellow-500/20 text-yellow-300'}`}>
                                                        {stats.winRate}% Win
                                                    </span>
                                                ) : (
                                                    <span className="text-[10px] sm:text-xs px-2 py-0.5 sm:px-2.5 sm:py-1 rounded-lg font-bold bg-white/10 text-zinc-400">N/A</span>
                                                )}
                                            </h4>
                                            <span className={`text-[8px] sm:text-[10px] font-bold uppercase px-2 py-0.5 sm:px-2.5 sm:py-1 rounded-lg bg-black/30 border border-white/10`}>{family.tag}</span>
                                        </div>
                                        <p className="text-sm sm:text-base font-bold opacity-90 mb-1 sm:mb-2">"{family.nickname}"</p>
                                        <p className="text-xs sm:text-sm opacity-80 mb-3 sm:mb-5 leading-relaxed">{family.personality}</p>
                                        
                                        <div className="space-y-2 sm:space-y-4">
                                            <div>
                                                <span className="text-[10px] sm:text-xs font-bold uppercase opacity-60 block mb-1 sm:mb-2">Typical Features</span>
                                                <ul className="list-disc list-inside text-[10px] sm:text-sm opacity-80 space-y-0.5 sm:space-y-1">
                                                    {family.features.slice(0, 3).map((f, i) => <li key={i}>{f}</li>)}
                                                </ul>
                                            </div>
                                            <div className="pt-2 sm:pt-3 border-t border-white/5">
                                                <span className="text-[10px] sm:text-xs font-bold uppercase opacity-60 block mb-0.5 sm:mb-1">Outcome Tendency</span>
                                                <p className="text-[10px] sm:text-sm opacity-90 italic">{family.tendency}</p>
                                            </div>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                </div>
            </div>

            {/* Core Frameworks Section */}
            <div>
                <div 
                    onClick={() => setIsFrameworksVisible(!isFrameworksVisible)} 
                    className="flex justify-between items-center cursor-pointer py-3 sm:py-4 group"
                >
                    <h3 className="text-xs sm:text-sm font-bold text-zinc-500 uppercase tracking-widest group-hover:text-zinc-300 transition-colors">Active Playbook</h3>
                    <ChevronDownIcon className={`w-4 h-4 sm:w-5 sm:h-5 text-zinc-600 transition-transform duration-200 ${isFrameworksVisible ? 'rotate-180' : ''}`} />
                </div>
                
                <div className={`collapsible-content ${isFrameworksVisible ? 'expanded' : ''}`}>
                    <div className="space-y-2 sm:space-y-3 mt-1 sm:mt-2">
                        {(activeFrameworks || []).length === 0 && <p className="text-zinc-500 italic p-4 text-center text-sm">No active strategies.</p>}
                        
                        {(activeFrameworks || []).map((framework, index) => {
                            const isDefault = defaultFrameworks.includes(framework);
                            const isViewing = viewingFramework === framework;
                            
                            return (
                                <div key={index} className={`rounded-lg sm:rounded-xl overflow-hidden border transition-all duration-300 ${isViewing ? 'bg-zinc-800 border-cyan-500/30 shadow-lg' : 'bg-zinc-900/50 border-white/5 hover:border-white/10'}`}>
                                    <div 
                                        className="p-3 sm:p-5 flex items-center justify-between cursor-pointer"
                                        onClick={() => handleViewFrameworkDetails(framework)}
                                    >
                                        <div className="flex items-center gap-3">
                                            {isDefault ? <LockIcon /> : <CheckIcon className="text-cyan-500" />}
                                            <span className={`font-bold text-sm sm:text-base ${isViewing ? 'text-cyan-400' : 'text-zinc-300'}`}>{framework}</span>
                                        </div>
                                        <div className="flex items-center gap-2 sm:gap-3">
                                            {!isDefault && (
                                                <button 
                                                    onClick={(e) => { e.stopPropagation(); onRemoveStrategy(framework); }}
                                                    className="p-1.5 sm:p-2 text-zinc-600 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-colors"
                                                >
                                                    <CloseIcon className="w-3 h-3 sm:w-4 sm:h-4" />
                                                </button>
                                            )}
                                            <ChevronDownIcon className={`w-4 h-4 sm:w-5 sm:h-5 text-zinc-600 transition-transform ${isViewing ? 'rotate-180' : ''}`} />
                                        </div>
                                    </div>
                                    
                                    {isViewing && (
                                        <div className="px-3 sm:px-5 pb-3 sm:pb-5 pt-0 animate-fade-in border-t border-white/5 mt-1 sm:mt-2">
                                            <div className="pt-2 sm:pt-4">
                                                {isFetchingDescription ? (
                                                    <div className="flex items-center gap-2 sm:gap-3 text-zinc-500">
                                                        <LoadingIcon className="w-3 h-3 sm:w-4 sm:h-4" />
                                                        <span className="text-xs sm:text-sm">Retrieving strategy details...</span>
                                                    </div>
                                                ) : (
                                                    <p className="text-sm sm:text-base text-zinc-300 leading-relaxed">{frameworkDescription}</p>
                                                )}
                                            </div>
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                </div>
            </div>

          </div>
        </div>
      </aside>
    </>
  );
};

export default StrategySearch;
