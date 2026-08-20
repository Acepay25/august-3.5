import { HermesBot } from '../../types/bot';

export const botMemoryFolder = (botId: string): string => `bots/${botId}`;

export const shouldIncludeSkillForBot = (
    bot: HermesBot | undefined,
    skill: { coin?: string; family?: string }
): boolean => {
    if (!bot?.skillFilter) return true;
    const { coins, families } = bot.skillFilter;
    if (coins && coins.length > 0 && skill.coin && !coins.includes(skill.coin)) return false;
    if (families && families.length > 0 && skill.family && !families.includes(skill.family)) return false;
    return true;
};

export const botScopedSkillKey = (botId: string, skillId: string): string => `${botId}:${skillId}`;
