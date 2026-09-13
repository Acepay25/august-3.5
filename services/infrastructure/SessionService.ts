/**
 * SessionService - Trading Session Detection and Context
 * Provides awareness of trading sessions, kill zones, and timing filters
 */

export type TradingSession = 'asian' | 'london' | 'new_york' | 'overlap' | 'off_hours';

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

// Session times in UTC — the BASELINE is summer time (BST for London,
// EDT for New York, when both regions are on daylight saving). Winter
// boundaries shift +1h via getEffectiveSessions() below; Asia (Tokyo)
// has no DST and stays fixed year-round.
const SESSIONS = {
    asian: {
        start: 0,   // 00:00 UTC (Tokyo open)
        end: 9,     // 09:00 UTC
        name: 'Asian Session'
    },
    london: {
        start: 7,   // 07:00 UTC in BST (08:00 in GMT) — London open
        end: 16,    // 16:00 UTC in BST (17:00 in GMT)
        name: 'London Session'
    },
    new_york: {
        start: 13,  // 13:00 UTC in EDT (14:00 in EST) — NY open
        end: 22,    // 22:00 UTC in EDT (23:00 in EST)
        name: 'New York Session'
    }
};

// Kill zones (high volatility windows) — DERIVED from the effective
// session boundaries (see getEffectiveSessions) so they stay aligned
// with the DST-shifted opens: London open, NY open, the London/NY
// overlap and the Asia close.

/** Last Sunday of a UTC month (day-of-month). */
const lastSundayOf = (year: number, month: number): number => {
    const last = new Date(Date.UTC(year, month + 1, 0));
    return last.getUTCDate() - last.getUTCDay();
};

/** Nth (1-based) Sunday of a UTC month (day-of-month). */
const nthSundayOf = (year: number, month: number, n: number): number =>
    1 + ((7 - new Date(Date.UTC(year, month, 1)).getUTCDay()) % 7) + (n - 1) * 7;

/** UK is on BST (UTC+1) from the last Sunday of March 01:00Z to the last
 *  Sunday of October 01:00Z. */
const isBritishSummerTime = (now: Date): boolean => {
    const y = now.getUTCFullYear();
    const start = Date.UTC(y, 2, lastSundayOf(y, 2), 1);
    const end = Date.UTC(y, 9, lastSundayOf(y, 9), 1);
    return now.getTime() >= start && now.getTime() < end;
};

/** New York is on EDT (UTC-4) from the 2nd Sunday of March 07:00Z (2am EST)
 *  to the 1st Sunday of November 06:00Z (2am EDT). */
const isEasternDaylightTime = (now: Date): boolean => {
    const y = now.getUTCFullYear();
    const start = Date.UTC(y, 2, nthSundayOf(y, 2, 2), 7);
    const end = Date.UTC(y, 10, nthSundayOf(y, 10, 1), 6);
    return now.getTime() >= start && now.getTime() < end;
};

/**
 * Effective session boundaries for RIGHT NOW: London and New York shift
 * +1h in their respective winter (GMT/EST); Asia never moves.
 */
const getEffectiveSessions = (now: Date = new Date()): typeof SESSIONS => {
    const ldnShift = isBritishSummerTime(now) ? 0 : 1;
    const nyShift = isEasternDaylightTime(now) ? 0 : 1;
    return {
        asian: SESSIONS.asian,
        london: { ...SESSIONS.london, start: SESSIONS.london.start + ldnShift, end: SESSIONS.london.end + ldnShift },
        new_york: { ...SESSIONS.new_york, start: SESSIONS.new_york.start + nyShift, end: SESSIONS.new_york.end + nyShift },
    };
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
 * Determine which session is currently active (against the DST-shifted
 * boundaries; the London/NY overlap outranks the individual sessions).
 */
const determineCurrentSession = (hour: number, sessions: typeof SESSIONS): TradingSession => {
    try {
        // Check for London-NY overlap first (highest priority)
        if (hour >= sessions.new_york.start && hour < sessions.london.end) {
            return 'overlap';
        }

        // Check individual sessions
        if (hour >= sessions.new_york.start && hour < sessions.new_york.end) {
            return 'new_york';
        }

        if (hour >= sessions.london.start && hour < sessions.london.end) {
            return 'london';
        }

        if (hour >= sessions.asian.start && hour < sessions.asian.end) {
            return 'asian';
        }

        return 'off_hours';
    } catch (error) {
        console.error('[SessionService] determineCurrentSession failed:', error);
        return 'off_hours';
    }
};

/**
 * Check if currently in a kill zone — the windows derive from the effective
 * session opens so they shift with DST alongside the sessions themselves.
 */
const checkKillZone = (hour: number, sessions: typeof SESSIONS): { isKillZone: boolean; type?: SessionContext['killZoneType'] } => {
    try {
        const inWindow = (zone: { start: number; end: number }): boolean =>
            hour >= zone.start && hour < zone.end;
        const londonOpen = { start: sessions.london.start, end: sessions.london.start + 2 };
        const nyOpen = { start: sessions.new_york.start, end: sessions.new_york.start + 2 };
        const overlap = { start: sessions.new_york.start, end: sessions.london.end };
        const asiaClose = { start: sessions.asian.end - 1, end: sessions.asian.end };

        if (inWindow(overlap)) {
            return { isKillZone: true, type: 'london_ny_overlap' };
        }
        if (inWindow(nyOpen)) {
            return { isKillZone: true, type: 'ny_open' };
        }
        if (inWindow(londonOpen)) {
            return { isKillZone: true, type: 'london_open' };
        }
        if (inWindow(asiaClose)) {
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
const getNextSession = (currentSession: TradingSession, hour: number, sessions: typeof SESSIONS): { session: TradingSession; minutesUntil: number } => {
    try {
        const currentMinutes = hour * 60 + getCurrentUTCMinute();

        const sessionStarts = [
            { session: 'asian' as TradingSession, startMinutes: sessions.asian.start * 60 },
            { session: 'london' as TradingSession, startMinutes: sessions.london.start * 60 },
            { session: 'new_york' as TradingSession, startMinutes: sessions.new_york.start * 60 }
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
            session: 'asian',
            minutesUntil: (24 * 60) - currentMinutes + sessions.asian.start * 60
        };
    } catch (error) {
        console.error('[SessionService] getNextSession failed:', error);
        return { session: 'asian', minutesUntil: 0 };
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
        const sessions = getEffectiveSessions();

        const sessionList: { id: TradingSession; data: typeof SESSIONS.asian; volatility: 'High' | 'Medium' | 'Low'; liquidationLevel: 'High' | 'Medium' | 'Low' }[] = [
            { id: 'asian', data: sessions.asian, volatility: 'Low', liquidationLevel: 'Low' },
            { id: 'london', data: sessions.london, volatility: 'Medium', liquidationLevel: 'Medium' },
            { id: 'new_york', data: sessions.new_york, volatility: 'High', liquidationLevel: 'High' }
        ];

        return sessionList.map(({ id, data, volatility, liquidationLevel }) => {
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
        nextSession: 'asian',
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
        if (!SESSIONS || !SESSIONS.london || !SESSIONS.asian || !SESSIONS.new_york) {
            console.error('[SessionService] SESSIONS constant is not properly defined');
            return defaultContext;
        }

        const hour = getCurrentUTCHour();
        const minute = getCurrentUTCMinute();
        const currentMinutes = hour * 60 + minute;

        // DST-aware boundaries: London/NY shift +1h in their winter.
        const sessions = getEffectiveSessions();

        // Determine current session
        const currentSession = determineCurrentSession(hour, sessions);

        // Get session details
        let sessionName: string;
        let sessionStart: string;
        let sessionEnd: string;
        let minutesIntoSession: number;
        let minutesToSessionEnd: number;

        switch (currentSession) {
            case 'asian':
                sessionName = sessions.asian.name;
                sessionStart = formatTime(sessions.asian.start);
                sessionEnd = formatTime(sessions.asian.end);
                minutesIntoSession = currentMinutes - sessions.asian.start * 60;
                minutesToSessionEnd = sessions.asian.end * 60 - currentMinutes;
                break;
            case 'london':
                sessionName = sessions.london.name;
                sessionStart = formatTime(sessions.london.start);
                sessionEnd = formatTime(sessions.london.end);
                minutesIntoSession = currentMinutes - sessions.london.start * 60;
                minutesToSessionEnd = sessions.london.end * 60 - currentMinutes;
                break;
            case 'new_york':
                sessionName = sessions.new_york.name;
                sessionStart = formatTime(sessions.new_york.start);
                sessionEnd = formatTime(sessions.new_york.end);
                minutesIntoSession = currentMinutes - sessions.new_york.start * 60;
                minutesToSessionEnd = sessions.new_york.end * 60 - currentMinutes;
                break;
            case 'overlap':
                sessionName = 'London/NY Overlap (High Volume)';
                sessionStart = formatTime(sessions.new_york.start);
                sessionEnd = formatTime(sessions.london.end);
                minutesIntoSession = currentMinutes - sessions.new_york.start * 60;
                minutesToSessionEnd = sessions.london.end * 60 - currentMinutes;
                break;
            default:
                sessionName = 'Off Hours (Low Liquidity)';
                sessionStart = formatTime(sessions.new_york.end);
                sessionEnd = formatTime(0);
                minutesIntoSession = 0;
                minutesToSessionEnd = 0;
        }

        // Check kill zones
        const killZoneCheck = checkKillZone(hour, sessions);

        // Get next session
        const nextSessionInfo = getNextSession(currentSession, hour, sessions);

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
        if (killZoneCheck.isKillZone || currentSession === 'overlap') {
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
        } else if (currentSession === 'overlap' || killZoneCheck.isKillZone) {
            suggestedAction = 'optimal';
        } else if (currentSession === 'london' || currentSession === 'new_york') {
            suggestedAction = 'good';
        } else if (currentSession === 'asian') {
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
            isHighVolatilityWindow: killZoneCheck.isKillZone || currentSession === 'overlap',
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
