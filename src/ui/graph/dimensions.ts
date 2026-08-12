/**
 * Node dimensions are CONSTANTS, not measured from the DOM.
 *
 * ELK needs width/height BEFORE laying out. If sizes were taken by measuring
 * rendered text, we'd get a render → measure → re-layout → render loop, and
 * the graph would jump a frame after every render. That's exactly the kind of
 * jitter Decision 2 exists to block. Long labels get cut with CSS
 * text-overflow, the box never grows.
 */
export const NODE_W = 224
export const NODE_H = 94

/**
 * Leaves room for a compound node's title, AND for the two edge lanes that
 * run along either side inside the scope.
 *
 * Left/right being wider than top/bottom is deliberate: the failure edge runs
 * UP along the right edge, the cancel edge runs DOWN along the left edge (see
 * GraphCanvas.tsx). Without these two lanes, their loops would hug the box
 * edge and cut through child nodes — exactly the "line on top of node"
 * problem the old layout had.
 */
export const CONTAINER_PADDING = { top: 44, left: 40, right: 40, bottom: 20 }
