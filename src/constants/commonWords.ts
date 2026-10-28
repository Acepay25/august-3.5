/**
 * Common English command/stop words excluded from symbol detection.
 * Shared by the GateKeeper symbol scan and the learning-context coin detection.
 */
export const COMMON_WORDS = [
    'ANALYZE', 'CHECK', 'LOOK', 'REVIEW', 'SHOW', 'TELL', 'GIVE',
    'WHAT', 'HOW', 'WHEN', 'WHERE', 'SHOULD', 'COULD', 'WOULD',
    'PLEASE', 'HELP', 'FIND', 'GET', 'SET', 'RUN', 'TEST',
    'TRADE', 'LONG', 'SHORT', 'BUY', 'SELL', 'SETUP', 'ENTRY',
    'EXIT', 'STOP', 'TAKE', 'PROFIT', 'LOSS', 'CHART', 'PRICE',
    'MARKET', 'UPDATE', 'THIS', 'THAT', 'WITH', 'FROM', 'INTO',
    'ABOUT', 'LIKE', 'JUST', 'SOME', 'MORE', 'VERY', 'ALSO',
    'EVEN', 'ONLY', 'SUCH', 'HERE', 'THERE', 'WELL', 'THAN',
    'THEM', 'THEN', 'BEEN', 'HAVE', 'WILL', 'DOES', 'DONE',
    'MAKE', 'MADE', 'WANT', 'NEED', 'MUST', 'TIME', 'DATA', 'INFO',
];
