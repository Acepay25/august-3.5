/**
 * AnalystLensSettings.tsx
 * 
 * UI component for users to configure analyst role assignments.
 * Allows assigning AI providers to specialized analytical roles.
 */

import React from 'react';
import { AIProvider, AnalystRole, AnalystRoleAssignment, AnalystLensConfig, TradingStyle } from '../types';
import {
  ANALYST_ROLE_DEFINITIONS,
  validateLensConfig,
  getAvailableRoles
} from '../services/AnalystLensService';

interface Props {
  config: AnalystLensConfig;
  enabledProviders: AIProvider[];
  onChange: (config: AnalystLensConfig) => void;
}

// Provider display names for the dropdown
const PROVIDER_DISPLAY_NAMES: Record<AIProvider, string> = {
  [AIProvider.GEMINI]: 'Gemini',
  [AIProvider.DEEPSEEK]: 'DeepSeek',
  [AIProvider.ZHIPU]: 'Zhipu',
  [AIProvider.GROQ]: 'Groq',
  [AIProvider.GROQ_NEW]: 'Groq (Alt)',
  [AIProvider.GROQ_ALT2]: 'Groq (Alt 2)',
  [AIProvider.OPENROUTER]: 'OpenRouter',
  [AIProvider.OPENAI]: 'OpenAI',
  [AIProvider.GROK]: 'Grok',
};

// Trading style options
const TRADING_STYLES: { value: TradingStyle; label: string; emoji: string; description: string }[] = [
  { value: 'position', label: 'Position', emoji: '🏛️', description: 'Daily/Weekly focus' },
  { value: 'swing', label: 'Swing', emoji: '🔄', description: '4H/Daily focus' },
  { value: 'scalp', label: 'Scalp', emoji: '⚡', description: '1m/5m/15m focus' },
  { value: 'auto', label: 'Auto', emoji: '🤖', description: 'AI detects best' },
];

export const AnalystLensSettings: React.FC<Props> = ({ config, enabledProviders, onChange }) => {
  const handleToggle = () => {
    onChange({
      ...config,
      enabled: !config.enabled,
    });
  };

  const handleAssignment = (role: AnalystRole, provider: AIProvider | null) => {
    const newAssignments = config.assignments.map(a =>
      a.role === role ? { ...a, assignedProvider: provider } : a
    );
    onChange({
      ...config,
      assignments: newAssignments,
    });
  };

  const handleStyleChange = (style: TradingStyle) => {
    onChange({
      ...config,
      tradingStyle: style,
    });
  };

  const validationError = validateLensConfig(config.assignments);
  const availableRoles = getAvailableRoles();

  // Get providers that are already assigned to other roles
  const getAssignedProviders = (excludeRole: AnalystRole): AIProvider[] => {
    return config.assignments
      .filter(a => a.role !== excludeRole && a.assignedProvider !== null)
      .map(a => a.assignedProvider as AIProvider);
  };

  return (
    <div className="analyst-lens-settings">
      {/* Header with toggle */}
      <div className="lens-header">
        <div className="lens-title">
          <span className="lens-icon">🎭</span>
          <h4>Analyst Lenses</h4>
        </div>
        <label className="toggle-switch">
          <input
            type="checkbox"
            checked={config.enabled}
            onChange={handleToggle}
          />
          <span className="toggle-slider"></span>
        </label>
      </div>

      <p className="lens-description">
        Assign specialized analytical roles to your enabled AI providers.
        Each role focuses the AI on a specific domain during ensemble debates.
      </p>

      {/* Trading Style Selector - Always visible, works with or without Lenses */}
      <div className="trading-style-section">
        <div className="style-label">Trading Style:</div>
        <div className="style-toggle-group">
          {TRADING_STYLES.map(style => (
            <button
              key={style.value}
              className={`style-button ${config.tradingStyle === style.value ? 'active' : ''}`}
              onClick={() => handleStyleChange(style.value)}
              title={style.description}
            >
              <span className="style-emoji">{style.emoji}</span>
              <span className="style-text">{style.label}</span>
            </button>
          ))}
        </div>
        <div className="style-description">
          {config.tradingStyle === 'swing' && '📈 Analyzing 15m/1H/4H for swing entries'}
          {config.tradingStyle === 'scalp' && '⚡ Analyzing 1m/5m/15m for quick scalps'}
          {config.tradingStyle === 'auto' && '🤖 AI detects best style from market conditions'}
        </div>
      </div>

      {/* Validation error banner */}
      {validationError && (
        <div className="lens-error-banner">
          ⚠️ {validationError}
        </div>
      )}

      {/* Role assignment grid */}
      <div className={`role-grid ${!config.enabled ? 'disabled' : ''}`}>
        {availableRoles.map(def => {
          const currentAssignment = config.assignments.find(a => a.role === def.id);
          const assignedProviders = getAssignedProviders(def.id);

          return (
            <div key={def.id} className="role-card">
              <div className="role-card-header">
                <span className="role-emoji">{def.emoji}</span>
                <span className="role-name">{def.shortName}</span>
              </div>

              <p className="role-focus">{def.focus}</p>

              <select
                className="provider-select"
                value={currentAssignment?.assignedProvider || ''}
                onChange={(e) => handleAssignment(
                  def.id,
                  e.target.value ? e.target.value as AIProvider : null
                )}
                disabled={!config.enabled}
              >
                <option value="">-- Not Assigned --</option>
                {enabledProviders.map(provider => {
                  const isAssignedElsewhere = assignedProviders.includes(provider);
                  return (
                    <option
                      key={provider}
                      value={provider}
                      disabled={isAssignedElsewhere}
                    >
                      {PROVIDER_DISPLAY_NAMES[provider]}
                      {isAssignedElsewhere ? ' (assigned)' : ''}
                    </option>
                  );
                })}
              </select>
            </div>
          );
        })}
      </div>

      {/* Info section */}
      {config.enabled && (
        <div className="lens-info">
          <div className="info-item">
            <span className="info-label">Assigned:</span>
            <span className="info-value">
              {config.assignments.filter(a => a.assignedProvider !== null).length} / 3 roles
            </span>
          </div>
          {enabledProviders.length < 3 && (
            <div className="info-warning">
              ⚠️ Enable at least 3 AI providers to fully utilize analyst lenses.
            </div>
          )}
        </div>
      )}

      <style>{`
        .analyst-lens-settings {
          background: rgba(30, 30, 40, 0.6);
          border-radius: 12px;
          padding: 16px;
          margin-top: 16px;
          border: 1px solid rgba(255, 255, 255, 0.1);
        }

        .lens-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 12px;
        }

        .lens-title {
          display: flex;
          align-items: center;
          gap: 8px;
        }

        .lens-title h4 {
          margin: 0;
          font-size: 16px;
          font-weight: 600;
          color: #fff;
        }

        .lens-icon {
          font-size: 20px;
        }

        .lens-description {
          font-size: 13px;
          color: rgba(255, 255, 255, 0.6);
          margin-bottom: 16px;
          line-height: 1.4;
        }

        .trading-style-section {
          background: rgba(40, 40, 55, 0.6);
          border-radius: 10px;
          padding: 12px;
          margin-bottom: 16px;
          border: 1px solid rgba(255, 255, 255, 0.08);
        }

        .style-label {
          font-size: 12px;
          color: rgba(255, 255, 255, 0.5);
          margin-bottom: 8px;
          text-transform: uppercase;
          letter-spacing: 0.5px;
        }

        .style-toggle-group {
          display: flex;
          gap: 6px;
          margin-bottom: 8px;
        }

        .style-button {
          flex: 1;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 6px;
          padding: 8px 12px;
          background: rgba(30, 30, 45, 0.8);
          border: 1px solid rgba(255, 255, 255, 0.1);
          border-radius: 8px;
          color: rgba(255, 255, 255, 0.6);
          font-size: 13px;
          cursor: pointer;
          transition: all 0.2s ease;
        }

        .style-button:hover {
          background: rgba(40, 40, 60, 0.9);
          border-color: rgba(255, 255, 255, 0.2);
        }

        .style-button.active {
          background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%);
          border-color: #6366f1;
          color: #fff;
        }

        .style-emoji {
          font-size: 16px;
        }

        .style-text {
          font-weight: 500;
        }

        .style-description {
          font-size: 11px;
          color: rgba(255, 255, 255, 0.45);
          text-align: center;
        }

        .lens-error-banner {
          background: rgba(239, 68, 68, 0.2);
          border: 1px solid rgba(239, 68, 68, 0.4);
          color: #fca5a5;
          padding: 10px 14px;
          border-radius: 8px;
          font-size: 13px;
          margin-bottom: 16px;
        }

        .role-grid {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 12px;
          transition: opacity 0.2s ease;
        }

        .role-grid.disabled {
          opacity: 0.5;
          pointer-events: none;
        }

        .role-card {
          background: rgba(40, 40, 55, 0.8);
          border-radius: 10px;
          padding: 14px;
          border: 1px solid rgba(255, 255, 255, 0.08);
          transition: border-color 0.2s ease;
        }

        .role-card:hover {
          border-color: rgba(255, 255, 255, 0.2);
        }

        .role-card-header {
          display: flex;
          align-items: center;
          gap: 8px;
          margin-bottom: 8px;
        }

        .role-emoji {
          font-size: 22px;
        }

        .role-name {
          font-size: 14px;
          font-weight: 600;
          color: #fff;
        }

        .role-focus {
          font-size: 11px;
          color: rgba(255, 255, 255, 0.5);
          margin-bottom: 12px;
          line-height: 1.4;
          min-height: 32px;
        }

        .provider-select {
          width: 100%;
          padding: 8px 10px;
          background: rgba(20, 20, 30, 0.8);
          border: 1px solid rgba(255, 255, 255, 0.15);
          border-radius: 6px;
          color: #fff;
          font-size: 13px;
          cursor: pointer;
          transition: border-color 0.2s ease;
        }

        .provider-select:hover {
          border-color: rgba(255, 255, 255, 0.3);
        }

        .provider-select:focus {
          outline: none;
          border-color: #6366f1;
        }

        .provider-select option {
          background: #1a1a2e;
          color: #fff;
        }

        .provider-select option:disabled {
          color: rgba(255, 255, 255, 0.3);
        }

        .toggle-switch {
          position: relative;
          display: inline-block;
          width: 44px;
          height: 24px;
        }

        .toggle-switch input {
          opacity: 0;
          width: 0;
          height: 0;
        }

        .toggle-slider {
          position: absolute;
          cursor: pointer;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          background-color: rgba(60, 60, 80, 0.8);
          transition: 0.3s;
          border-radius: 24px;
        }

        .toggle-slider:before {
          position: absolute;
          content: "";
          height: 18px;
          width: 18px;
          left: 3px;
          bottom: 3px;
          background-color: white;
          transition: 0.3s;
          border-radius: 50%;
        }

        .toggle-switch input:checked + .toggle-slider {
          background-color: #6366f1;
        }

        .toggle-switch input:checked + .toggle-slider:before {
          transform: translateX(20px);
        }

        .lens-info {
          margin-top: 14px;
          padding-top: 14px;
          border-top: 1px solid rgba(255, 255, 255, 0.08);
        }

        .info-item {
          display: flex;
          justify-content: space-between;
          font-size: 13px;
        }

        .info-label {
          color: rgba(255, 255, 255, 0.5);
        }

        .info-value {
          color: #6366f1;
          font-weight: 500;
        }

        .info-warning {
          margin-top: 10px;
          font-size: 12px;
          color: #fbbf24;
        }

        @media (max-width: 768px) {
          .role-grid {
            grid-template-columns: 1fr;
          }

          .role-focus {
            min-height: auto;
          }
        }
      `}</style>
    </div>
  );
};

export default AnalystLensSettings;
