
import React, { useState } from 'react';
import { ChevronDownIcon, ActivityIcon, BrainIcon } from '../shared/Icons';
import { DetectedPattern } from '../../utils/patternDetection';

// Interfaces matching the AI-optimized nested structure
interface TrendIndicators {
    candle_pattern: string;
    ma: Record<string, number | null>;
    ema: Record<string, number | null>;
    bollinger: { upper: number | null; mid: number | null; lower: number | null };
    sar: number | null;
}

interface MomentumIndicators {
    rsi14: number | null;
    rsi2: number | null;
    rsi3: number | null;
    macd: { dif: number | null; dea: number | null; hist: number | null };
    kdj: { k: number | null; d: number | null; j: number | null };
    volume: number;
}

interface StructuralAnalysis {
    detected_patterns: DetectedPattern[];
    key_zones: { support: number[]; resistance: number[] };
}

interface TimeframeData {
  price: number;
  trend_indicators: TrendIndicators;
  momentum_indicators: MomentumIndicators;
  structural_analysis: StructuralAnalysis;
}

interface MarketData {
  asset: string;
  timestamp: string;
  timeframes: {
    '5m'?: TimeframeData;
    '15m'?: TimeframeData;
    '1h'?: TimeframeData;
    '4h'?: TimeframeData;
  };
}

const TimeframeSection: React.FC<{ label: string; data: TimeframeData | undefined; isOpen: boolean; onToggle: () => void }> = ({ label, data, isOpen, onToggle }) => {
  if (!data) return null;

  const { trend_indicators, momentum_indicators, structural_analysis, price } = data;
  
  // Safe accessors in case older JSON format is present or fields are missing
  const patterns = structural_analysis?.detected_patterns || [];
  const keyZones = structural_analysis?.key_zones || { support: [], resistance: [] };
  const candlePattern = trend_indicators?.candle_pattern || 'Normal';
  
  const rsi = momentum_indicators?.rsi14;
  const rsi2 = momentum_indicators?.rsi2;
  const rsi3 = momentum_indicators?.rsi3;
  const sar = trend_indicators?.sar;
  const kdj = momentum_indicators?.kdj;
  const macd = momentum_indicators?.macd;
  const bb = trend_indicators?.bollinger;
  const ma = trend_indicators?.ma;
  const ema = trend_indicators?.ema;

  const formatNum = (num: number | string | null | undefined) => {
      if (num === null || num === undefined || (typeof num === 'number' && isNaN(num))) return '-';
      return typeof num === 'number' ? num.toFixed(2) : num;
  };

  return (
    <div className="border border-white/5 rounded-lg bg-zinc-900/50 overflow-hidden mb-2">
      <button 
        onClick={onToggle}
        className="w-full flex items-center justify-between p-3 bg-white/5 hover:bg-white/10 transition-colors"
      >
        <div className="flex items-center gap-3">
            <span className="text-sm font-bold text-cyan-400 uppercase tracking-wider w-8">{label}</span>
            <span className="text-xs font-mono text-zinc-400">Price: <span className="text-white font-bold">{price}</span></span>
            {patterns.length > 0 ? (
                <span className="text-[10px] px-2 py-0.5 rounded border bg-purple-500/20 border-purple-500/30 text-purple-300 animate-pulse">
                    {patterns.length} Pattern{patterns.length > 1 ? 's' : ''}
                </span>
            ) : (
                <span className={`text-[10px] px-2 py-0.5 rounded border ${candlePattern !== 'Normal' ? 'bg-yellow-500/20 border-yellow-500/30 text-yellow-300' : 'bg-zinc-800 border-zinc-700 text-zinc-500'}`}>
                    {candlePattern}
                </span>
            )}
        </div>
        <ChevronDownIcon className={`w-4 h-4 text-zinc-500 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`} />
      </button>
      
      {isOpen && (
        <div className="p-4 grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs font-mono animate-fade-in">
           {/* Pattern Scanner */}
           {patterns.length > 0 && (
               <div className="col-span-1 sm:col-span-2 bg-zinc-800/30 rounded-lg p-3 border border-white/5 mb-2">
                   <h4 className="text-[10px] font-bold text-purple-400 uppercase tracking-widest mb-2 flex items-center gap-2">
                       <BrainIcon className="w-3 h-3" /> Algorithmic Pattern Scanner
                   </h4>
                   <div className="space-y-2">
                       {patterns.map((p, idx) => (
                           <div key={idx} className="flex items-start justify-between bg-black/20 p-2 rounded border border-white/5">
                               <div>
                                   <div className="flex items-center gap-2">
                                       <span className="font-bold text-zinc-200">{p.name}</span>
                                       <span className={`text-[9px] px-1.5 py-0.5 rounded uppercase font-bold ${p.type === 'bullish' ? 'bg-emerald-500/20 text-emerald-400' : p.type === 'bearish' ? 'bg-red-500/20 text-red-400' : 'bg-yellow-500/20 text-yellow-400'}`}>
                                           {p.type}
                                       </span>
                                   </div>
                                   <p className="text-[10px] text-zinc-500 mt-0.5">{p.description}</p>
                               </div>
                               <div className="text-right">
                                   <span className="block text-[10px] text-zinc-400">{p.significance}</span>
                                   <span className="text-[9px] text-zinc-600 font-bold">{(p.confidence * 100).toFixed(0)}% Conf.</span>
                               </div>
                           </div>
                       ))}
                   </div>
               </div>
           )}

           {/* Oscillators */}
           <div className="space-y-2">
              <h4 className="text-[10px] font-bold text-zinc-600 uppercase tracking-widest mb-1 border-b border-white/5 pb-1">Momentum & Oscillators</h4>
              <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                  <div className="flex justify-between">
                      <span className="text-zinc-500">RSI(14)</span>
                      <span className={`${(rsi ?? 50) > 70 ? 'text-red-400' : (rsi ?? 50) < 30 ? 'text-emerald-400' : 'text-zinc-200'}`}>{formatNum(rsi)}</span>
                  </div>
                  <div className="flex justify-between">
                      <span className="text-zinc-500">SAR</span>
                      <span className={`${(sar ?? 0) < price ? 'text-emerald-400' : 'text-red-400'}`}>{formatNum(sar)}</span>
                  </div>
              </div>
              
              <div className="flex justify-between text-[10px] text-zinc-500 mt-1 pt-1 border-t border-white/5">
                  <span title="RSI 2">RSI(2): <span className="text-zinc-300">{formatNum(rsi2)}</span></span>
                  <span title="RSI 3">RSI(3): <span className="text-zinc-300">{formatNum(rsi3)}</span></span>
              </div>
              
              <div className="pt-1 mt-1">
                  <div className="flex justify-between text-zinc-500 text-[10px] mb-0.5">
                      <span>KDJ (9,3,3)</span>
                  </div>
                  <div className="flex justify-between bg-black/20 px-2 py-1 rounded border border-white/5">
                      <span>K: <span className="text-zinc-300">{formatNum(kdj?.k)}</span></span>
                      <span>D: <span className="text-zinc-300">{formatNum(kdj?.d)}</span></span>
                      <span>J: <span className="text-zinc-300">{formatNum(kdj?.j)}</span></span>
                  </div>
              </div>

              <div className="pt-1">
                  <div className="flex justify-between text-zinc-500 text-[10px] mb-0.5">
                      <span>MACD (12,26,9)</span>
                      <span className={`${(macd?.hist || 0) > 0 ? 'text-emerald-400' : 'text-red-400'}`}>Hist: {formatNum(macd?.hist)}</span>
                  </div>
                  <div className="flex justify-between bg-black/20 px-2 py-1 rounded border border-white/5">
                      <span>DIF: <span className="text-zinc-300">{formatNum(macd?.dif)}</span></span>
                      <span>DEA: <span className="text-zinc-300">{formatNum(macd?.dea)}</span></span>
                  </div>
              </div>
              
              <div className="pt-1">
                  <div className="flex justify-between text-zinc-500 text-[10px] mb-0.5">
                      <span>Bollinger Bands (20, 2)</span>
                  </div>
                  <div className="grid grid-cols-3 gap-1 text-center bg-black/20 p-1 rounded border border-white/5 text-[10px]">
                      <span className="text-zinc-400" title="Upper">{formatNum(bb?.upper)}</span>
                      <span className="text-cyan-600" title="Mid">{formatNum(bb?.mid)}</span>
                      <span className="text-zinc-400" title="Lower">{formatNum(bb?.lower)}</span>
                  </div>
              </div>
           </div>

           {/* Moving Averages */}
           <div className="space-y-2">
              <h4 className="text-[10px] font-bold text-zinc-600 uppercase tracking-widest mb-1 border-b border-white/5 pb-1">Trend Lines (MA & EMA)</h4>
              
              {/* MA Table */}
              <div className="grid grid-cols-3 gap-2 text-[10px]">
                  <div className="bg-zinc-800/30 p-1.5 rounded border border-white/5">
                      <span className="block text-zinc-500 text-[9px]">MA5</span>
                      <span className="text-zinc-200">{formatNum(ma?.['5'])}</span>
                  </div>
                  <div className="bg-zinc-800/30 p-1.5 rounded border border-white/5">
                      <span className="block text-zinc-500 text-[9px]">MA10</span>
                      <span className="text-zinc-200">{formatNum(ma?.['10'])}</span>
                  </div>
                  <div className="bg-zinc-800/30 p-1.5 rounded border border-white/5">
                      <span className="block text-zinc-500 text-[9px]">MA20</span>
                      <span className="text-cyan-300 font-bold">{formatNum(ma?.['20'])}</span>
                  </div>
                  <div className="bg-zinc-800/30 p-1.5 rounded border border-white/5">
                      <span className="block text-zinc-500 text-[9px]">MA30</span>
                      <span className="text-zinc-200">{formatNum(ma?.['30'])}</span>
                  </div>
                  <div className="bg-zinc-800/30 p-1.5 rounded border border-white/5">
                      <span className="block text-zinc-500 text-[9px]">MA60</span>
                      <span className="text-zinc-200">{formatNum(ma?.['60'])}</span>
                  </div>
                  <div className="bg-zinc-800/30 p-1.5 rounded border border-white/5">
                      <span className="block text-zinc-500 text-[9px]">MA200</span>
                      <span className="text-purple-300 font-bold">{formatNum(ma?.['200'])}</span>
                  </div>
              </div>

              {/* EMA Table */}
              <div className="grid grid-cols-4 gap-2 text-[10px] mt-2">
                  <div className="bg-zinc-800/30 p-1.5 rounded border border-white/5">
                      <span className="block text-zinc-500 text-[9px]">EMA5</span>
                      <span className="text-zinc-200">{formatNum(ema?.['5'])}</span>
                  </div>
                  <div className="bg-zinc-800/30 p-1.5 rounded border border-white/5">
                      <span className="block text-zinc-500 text-[9px]">EMA13</span>
                      <span className="text-zinc-200">{formatNum(ema?.['13'])}</span>
                  </div>
                  <div className="bg-zinc-800/30 p-1.5 rounded border border-white/5">
                      <span className="block text-zinc-500 text-[9px]">EMA20</span>
                      <span className="text-cyan-300">{formatNum(ema?.['20'])}</span>
                  </div>
                  <div className="bg-zinc-800/30 p-1.5 rounded border border-white/5">
                      <span className="block text-zinc-500 text-[9px]">EMA200</span>
                      <span className="text-purple-300">{formatNum(ema?.['200'])}</span>
                  </div>
              </div>
           </div>
        </div>
      )}
    </div>
  );
};

const LiveMarketDataView: React.FC<{ jsonString: string }> = ({ jsonString }) => {
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({ '5m': true, '15m': true, '1h': false, '4h': false });
  
  let data: MarketData | null = null;
  try {
      data = JSON.parse(jsonString);
  } catch (e) {
      console.error("Error parsing live market data JSON:", e);
      return <div className="p-3 bg-red-500/10 border border-red-500/20 text-red-300 text-xs rounded">Error parsing live market data.</div>;
  }

  if (!data || !data.timeframes) return null;

  const toggleSection = (key: string) => {
      setOpenSections(prev => ({ ...prev, [key]: !prev[key] }));
  };

  return (
    <div className="my-4 border border-white/10 rounded-xl bg-zinc-950/30 overflow-hidden">
        <div className="p-3 bg-gradient-to-r from-cyan-900/20 to-zinc-900/20 border-b border-white/5 flex justify-between items-center">
            <div className="flex items-center gap-2">
                <ActivityIcon className="text-cyan-400 w-4 h-4" />
                <h3 className="text-xs font-bold text-zinc-200 uppercase tracking-widest">Live Market Extraction</h3>
            </div>
            <div className="text-right">
                <div className="text-sm font-black text-white">{data.asset || 'Unknown'}</div>
                <div className="text-[9px] text-zinc-500 font-mono">{data.timestamp ? new Date(data.timestamp).toLocaleTimeString() : ''}</div>
            </div>
        </div>
        
        <div className="p-3">
            {data.timeframes['5m'] && <TimeframeSection label="5M" data={data.timeframes['5m']} isOpen={openSections['5m']} onToggle={() => toggleSection('5m')} />}
            {data.timeframes['15m'] && <TimeframeSection label="15M" data={data.timeframes['15m']} isOpen={openSections['15m']} onToggle={() => toggleSection('15m')} />}
            {data.timeframes['1h'] && <TimeframeSection label="1H" data={data.timeframes['1h']} isOpen={openSections['1h']} onToggle={() => toggleSection('1h')} />}
            {data.timeframes['4h'] && <TimeframeSection label="4H" data={data.timeframes['4h']} isOpen={openSections['4h']} onToggle={() => toggleSection('4h')} />}
        </div>
    </div>
  );
};

export default LiveMarketDataView;
