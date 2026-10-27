// One content container for every page inside the shell (journal, analytics, settings), so the
// pages share the same gutters. It is not centred: its left edge is the module tabs' edge (same
// px-4 / lg:px-8), so the tabs and the page start on one line. The cap only matters on very wide
// screens. Narrower content (a settings form) sets its own width inside it.
export const PAGE_CONTAINER = 'w-full max-w-[1800px] px-4 py-5 lg:px-8 lg:py-6'
