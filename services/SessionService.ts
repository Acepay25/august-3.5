/**
 * SessionService - Trading Session Detection and Context
 * Provides awareness of trading sessions, kill zones, and timing filters
 */

export type TradingSession = 'asia' | 'london' | 'new_york' | 'overlap_london_ny' | 'off_hours';

export interface SessionContext {
    currentSession: TradingSession;
    sessionName: string;
    sessionStart: string;           // HH:MM UTC
    sessionEnd: string;             // HH:MM UTC
    minutesIntoSession: number;
    minutesToSessionEnd: number;
    nextSession: TradingSession;
    minutesToNextSession: number;

    // Kill Zone / High Volatility Windows
    isKillZone: boolean;            // London/NY open (first 1-2 hours)
    isHighVolatilityWindow: boolean;
    killZoneType?: 'london_open' | 'ny_open' | 'london_ny_overlap' | 'asia_close';

    // Calendar awareness
    dayOfWeek: string;
    isWeekend: boolean;
    isWeeklyClose: boolean;         // Friday close approaching
    isMonthlyClose: boolean;        // Last day of month

    // Trading recommendations
    warnings: string[];
    suggestedAction: 'optimal' | 'good' | 'caution' | 'avoid';
    volatilityExpectation: 'high' | 'medium' | 'low';
}

// Session times in UTC
const SESSIONS = {
    asia: {
        start: 0,   // 00:00 UTC (Tokyo open)
        end: 9,     // 09:00 UTC
        name: 'Asian Session'
    },
    london: {
        start: 7,   // 07:00 UTC (London open)
        end: 16,    // 16:00 UTC
        name: 'London Session'
    },
    new_york: {
        start: 13,  // 13:00 UTC (NY open)
        end: 22,    // 22:00 UTC
        name: 'New York Session'
    }
};

// Kill zones (high volatility windows) in UTC hours
const KILL_ZONES = {
    london_open: { start: 7, end: 9 },      // London open
    ny_open: { start: 13, end: 15 },        // NY open
    london_ny_overlap: { start: 13, end: 16 }, // Overlap period
    asia_close: { start: 8, end: 9 }        // Asia close / London pre-open
};

/**
 * Get current hour in UTC
 */
const getCurrentUTCHour = (): number => {
    return new Date().getUTCHours();
};

/**
 * Get current minute in UTC
 */
const getCurrentUTCMinute = (): number => {
    return new Date().getUTCMinutes();
};

/**
 * Determine which session is currently active
 */
const determineCurrentSession = (hour: number): TradingSession => {
    try {
        // Check for London-NY overlap first (highest priority)
        if (hour >= 13 && hour < 16) {
            return 'overlap_london_ny';
        }

        // Safe access with fallback values
        const nyStart = SESSIONS?.new_york?.start ?? 13;
        const nyEnd = SESSIONS?.new_york?.end ?? 22;
        const londonStart = SESSIONS?.london?.start ?? 7;
        const londonEnd = SESSIONS?.london?.end ?? 16;
        const asiaStart = SESSIONS?.asia?.start ?? 0;
        const asiaEnd = SESSIONS?.asia?.end ?? 9;

        // Check individual sessions
        if (hour >= nyStart && hour < nyEnd) {
            return 'new_york';
        }

        if (hour >= londonStart && hour < londonEnd) {
            return 'london';
        }

        if (hour >= asiaStart && hour < asiaEnd) {
            return 'asia';
        }

        return 'off_hours';
    } catch (error) {
        console.error('[SessionService] determineCurrentSession failed:', error);
        return 'off_hours';
    }
};

/**
 * Check if currently in a kill zone
 */
const checkKillZone = (hour: number): { isKillZone: boolean; type?: SessionContext['killZoneType'] } => {
    try {
        // Safe access with fallback values
        const londonNyOverlapStart = KILL_ZONES?.london_ny_overlap?.start ?? 13;
        const londonNyOverlapEnd = KILL_ZONES?.london_ny_overlap?.end ?? 16;
        const nyOpenStart = KILL_ZONES?.ny_open?.start ?? 13;
        const nyOpenEnd = KILL_ZONES?.ny_open?.end ?? 15;
        const londonOpenStart = KILL_ZONES?.london_open?.start ?? 7;
        const londonOpenEnd = KILL_ZONES?.london_open?.end ?? 9;
        const asiaCloseStart = KILL_ZONES?.asia_close?.start ?? 8;
        const asiaCloseEnd = KILL_ZONES?.asia_close?.end ?? 9;

        if (hour >= londonNyOverlapStart && hour < londonNyOverlapEnd) {
            return { isKillZone: true, type: 'london_ny_overlap' };
        }
        if (hour >= nyOpenStart && hour < nyOpenEnd) {
            return { isKillZone: true, type: 'ny_open' };
        }
        if (hour >= londonOpenStart && hour < londonOpenEnd) {
            return { isKillZone: true, type: 'london_open' };
        }
        if (hour >= asiaCloseStart && hour < asiaCloseEnd) {
            return { isKillZone: true, type: 'asia_close' };
        }
        return { isKillZone: false };
    } catch (error) {
        console.error('[SessionService] checkKillZone failed:', error);
        return { isKillZone: false };
    }
};

/**
 * Get the next trading session
 */
const getNextSession = (currentSession: TradingSession, hour: number): { session: TradingSession; minutesUntil: number } => {
    try {
        const currentMinutes = hour * 60 + getCurrentUTCMinute();

        // Safe access with fallback values
        const asiaStart = SESSIONS?.asia?.start ?? 0;
        const londonStart = SESSIONS?.london?.start ?? 7;
        const nyStart = SESSIONS?.new_york?.start ?? 13;

        const sessionStarts = [
            { session: 'asia' as TradingSession, startMinutes: asiaStart * 60 },
            { session: 'london' as TradingSession, startMinutes: londonStart * 60 },
            { session: 'new_york' as TradingSession, startMinutes: nyStart * 60 }
        ];

        // Find next session start
        for (const s of sessionStarts) {
            if (s.startMinutes > currentMinutes) {
                return {
                    session: s.session,
                    minutesUntil: s.startMinutes - currentMinutes
                };
            }
        }

        // Wrap around to next day's Asia session
        return {
            session: 'asia',
            minutesUntil: (24 * 60) - currentMinutes + asiaStart * 60
        };
    } catch (error) {
        console.error('[SessionService] getNextSession failed:', error);
        return { session: 'asia', minutesUntil: 0 };
    }
};

/**
 * Check if it's a weekend
 */
export const isWeekend = (): boolean => {
    const day = new Date().getUTCDay();
    return day === 0 || day === 6; // Sunday or Saturday
};

/**
 * Check if approaching weekly close (Friday after 20:00 UTC)
 */
export const isWeeklyClose = (): boolean => {
    const now = new Date();
    const day = now.getUTCDay();
    const hour = now.getUTCHours();
    return day === 5 && hour >= 20; // Friday after 20:00 UTC
};

/**
 * Check if it's the last day of the month
 */
export const isMonthlyClose = (): boolean => {
    const now = new Date();
    const tomorrow = new Date(now);
    tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
    return tomorrow.getUTCMonth() !== now.getUTCMonth();
};

/**
 * Get the current day of week
 */
export const getDayOfWeek = (): string => {
    const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    return days[new Date().getUTCDay()];
};

/**
 * Format hour to HH:MM string
 */
const formatTime = (hour: number, minute: number = 0): string => {
    return `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`;
};

export interface SessionStatus {
    id: TradingSession;
    name: string;
    isOpen: boolean;
    opensInMinutes: number; // Minutes until open (0 if currently open)
    closesInMinutes: number; // Minutes until close (0 if currently closed)
    utcStart: number;
    utcEnd: number;
    volatility: 'High' | 'Medium' | 'Low';
    liquidationLevel: 'High' | 'Medium' | 'Low';
}

/**
 * Get status of all major sessions
 */
export const getAllSessionsStatus = (): SessionStatus[] => {
    try {
        const hour = getCurrentUTCHour();
        const minute = getCurrentUTCMinute();
        const currentMinutes = hour * 60 + minute;

        const sessions: { id: TradingSession; data: typeof SESSIONS.asia; volatility: 'High' | 'Medium' | 'Low'; liquidationLevel: 'High' | 'Medium' | 'Low' }[] = [
            { id: 'asia', data: SESSIONS.asia, volatility: 'Low', liquidationLevel: 'Low' },
            { id: 'london', data: SESSIONS.london, volatility: 'Medium', liquidationLevel: 'Medium' },
            { id: 'new_york', data: SESSIONS.new_york, volatility: 'High', liquidationLevel: 'High' }
        ];

        return sessions.map(({ id, data, volatility, liquidationLevel }) => {
            const startMinutes = data.start * 60;
            const endMinutes = data.end * 60;

            let isOpen = false;
            let opensIn = 0;
            let closesIn = 0;

            if (currentMinutes >= startMinutes && currentMinutes < endMinutes) {
                // Currently Open
                isOpen = true;
                closesIn = endMinutes - currentMinutes;
            } else if (currentMinutes < startMinutes) {
                // Not open yet, opens today
                opensIn = startMinutes - currentMinutes;
            } else {
                // Closed for the day, opens tomorrow
                opensIn = (24 * 60) - currentMinutes + startMinutes;
            }

            return {
                id,
                name: data.name,
                isOpen,
                opensInMinutes: opensIn,
                closesInMinutes: closesIn,
                utcStart: data.start,
                utcEnd: data.end,
                volatility,
                liquidationLevel
            };
        }).sort((a, b) => {
            // Sort logic: Open sessions first, then by closest start time
            if (a.isOpen && !b.isOpen) return -1;
            if (!a.isOpen && b.isOpen) return 1;
            if (a.isOpen && b.isOpen) return 0; // Both open (overlap), keep order
            return a.opensInMinutes - b.opensInMinutes; // Both closed, nearest first
        });
    } catch (error) {
        console.error('[SessionService] getAllSessionsStatus failed:', error);
        return [];
    }
};

/**
 * Get complete session context
 */
export const getSessionContext = (): SessionContext => {
    // Default fallback context in case of any errors
    const defaultContext: SessionContext = {
        currentSession: 'off_hours',
        sessionName: 'Unknown Session',
        sessionStart: '00:00',
        sessionEnd: '00:00',
        minutesIntoSession: 0,
        minutesToSessionEnd: 0,
        nextSession: 'asia',
        minutesToNextSession: 0,
        isKillZone: false,
        isHighVolatilityWindow: false,
        killZoneType: undefined,
        dayOfWeek: 'Unknown',
        isWeekend: false,
        isWeeklyClose: false,
        isMonthlyClose: false,
        warnings: [],
        suggestedAction: 'caution',
        volatilityExpectation: 'low'
    };

    try {
        // Verify SESSIONS constant is properly defined
        if (!SESSIONS || !SESSIONS.london || !SESSIONS.asia || !SESSIONS.new_york) {
            console.error('[SessionService] SESSIONS constant is not properly defined');
            return defaultContext;
        }

        const hour = getCurrentUTCHour();
        const minute = getCurrentUTCMinute();
        const currentMinutes = hour * 60 + minute;

        // Determine current session
        const currentSession = determineCurrentSession(hour);

        // Get session details
        let sessionName: string;
        let sessionStart: string;
        let sessionEnd: string;
        let minutesIntoSession: number;
        let minutesToSessionEnd: number;

        switch (currentSession) {
            case 'asia':
                sessionName = SESSIONS.asia.name;
                sessionStart = formatTime(SESSIONS.asia.start);
                sessionEnd = formatTime(SESSIONS.asia.end);
                minutesIntoSession = currentMinutes - SESSIONS.asia.start * 60;
                minutesToSessionEnd = SESSIONS.asia.end * 60 - currentMinutes;
                break;
            case 'london':
                sessionName = SESSIONS.london.name;
                sessionStart = formatTime(SESSIONS.london.start);
                sessionEnd = formatTime(SESSIONS.london.end);
                minutesIntoSession = currentMinutes - SESSIONS.london.start * 60;
                minutesToSessionEnd = SESSIONS.london.end * 60 - currentMinutes;
                break;
            case 'new_york':
                sessionName = SESSIONS.new_york.name;
                sessionStart = formatTime(SESSIONS.new_york.start);
                sessionEnd = formatTime(SESSIONS.new_york.end);
                minutesIntoSession = currentMinutes - SESSIONS.new_york.start * 60;
                minutesToSessionEnd = SESSIONS.new_york.end * 60 - currentMinutes;
                break;
            case 'overlap_london_ny':
                sessionName = 'London/NY Overlap (High Volume)';
                sessionStart = formatTime(13);
                sessionEnd = formatTime(16);
                minutesIntoSession = currentMinutes - 13 * 60;
                minutesToSessionEnd = 16 * 60 - currentMinutes;
                break;
            default:
                sessionName = 'Off Hours (Low Liquidity)';
                sessionStart = formatTime(22);
                sessionEnd = formatTime(0);
                minutesIntoSession = 0;
                minutesToSessionEnd = 0;
        }

        // Check kill zones
        const killZoneCheck = checkKillZone(hour);

        // Get next session
        const nextSessionInfo = getNextSession(currentSession, hour);

        // Calendar checks
        const weekend = isWeekend();
        const weeklyClose = isWeeklyClose();
        const monthlyClose = isMonthlyClose();
        const dayOfWeek = getDayOfWeek();

        // Generate warnings
        const warnings: string[] = [];

        if (weekend) {
            warnings.push('⚠️ Weekend: Low liquidity, potential gap risk');
        }
        if (weeklyClose) {
            warnings.push('⚠️ Weekly close approaching: Position sizing caution');
        }
        if (monthlyClose) {
            warnings.push('⚠️ Monthly close: Potential rebalancing flows');
        }
        if (currentSession === 'off_hours') {
            warnings.push('⚠️ Off-hours: Lower liquidity, wider spreads expected');
        }
        if (killZoneCheck.type === 'london_ny_overlap') {
            warnings.push('🎯 Kill Zone Active: London/NY overlap - highest volume period');
        }

        // Determine volatility expectation
        let volatilityExpectation: 'high' | 'medium' | 'low';
        if (killZoneCheck.isKillZone || currentSession === 'overlap_london_ny') {
            volatilityExpectation = 'high';
        } else if (currentSession === 'london' || currentSession === 'new_york') {
            volatilityExpectation = 'medium';
        } else {
            volatilityExpectation = 'low';
        }

        // Determine suggested action
        let suggestedAction: 'optimal' | 'good' | 'caution' | 'avoid';
        if (weekend) {
            suggestedAction = 'avoid';
        } else if (currentSession === 'overlap_london_ny' || killZoneCheck.isKillZone) {
            suggestedAction = 'optimal';
        } else if (currentSession === 'london' || currentSession === 'new_york') {
            suggestedAction = 'good';
        } else if (currentSession === 'asia') {
            suggestedAction = 'caution';
        } else {
            suggestedAction = 'avoid';
        }

        return {
            currentSession,
            sessionName,
            sessionStart,
            sessionEnd,
            minutesIntoSession: Math.max(0, minutesIntoSession),
            minutesToSessionEnd: Math.max(0, minutesToSessionEnd),
            nextSession: nextSessionInfo.session,
            minutesToNextSession: nextSessionInfo.minutesUntil,
            isKillZone: killZoneCheck.isKillZone,
            isHighVolatilityWindow: killZoneCheck.isKillZone || currentSession === 'overlap_london_ny',
            killZoneType: killZoneCheck.type,
            dayOfWeek,
            isWeekend: weekend,
            isWeeklyClose: weeklyClose,
            isMonthlyClose: monthlyClose,
            warnings,
            suggestedAction,
            volatilityExpectation
        };
    } catch (error) {
        console.error('[SessionService] getSessionContext failed:', error);
        return defaultContext;
    }
};

/**
 * Generate human-readable session summary for AI context
 */
export const generateSessionSummary = (context: SessionContext): string => {
    const warningsText = context.warnings.length > 0
        ? `\n- Warnings: ${context.warnings.join('; ')}`
        : '';

    return `
📅 **SESSION CONTEXT:**
- Current: ${context.sessionName}
- Session Time: ${context.sessionStart} - ${context.sessionEnd} UTC
- Time in Session: ${context.minutesIntoSession} min | Until End: ${context.minutesToSessionEnd} min
- Kill Zone Active: ${context.isKillZone ? `YES (${context.killZoneType})` : 'No'}
- Volatility Expectation: ${context.volatilityExpectation.toUpperCase()}
- Trading Condition: ${context.suggestedAction.toUpperCase()}
- Day: ${context.dayOfWeek}${context.isWeekend ? ' (WEEKEND)' : ''}${warningsText}
`.trim();
};
