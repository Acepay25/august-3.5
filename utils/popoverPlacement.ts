/**
 * Which side of its trigger a popover opens on.
 *
 * One rule, two callers: the Chart AI composer's symbol picker (a portal, so it
 * positions by viewport coordinates) and its timeframe chip (absolutely
 * positioned inside the bar, so it swaps `top-*` for `bottom-*`). Both live at
 * the BOTTOM of the window, where a list that always opens downward runs off the
 * edge and across whatever text sits under the card.
 */

/** True when the panel will not fit below the trigger and there is more room
 *  above. `panelHeight` is the list's own ceiling, not its measured height —
 *  the caller anchors by the panel's bottom edge when flipping, so a short
 *  result list leaves no gap and the estimate only has to be generous. */
export const shouldOpenUpward = (
    rect: { top: number; bottom: number },
    panelHeight: number,
): boolean => {
    const below = window.innerHeight - rect.bottom;
    return below < panelHeight && rect.top > below;
};
