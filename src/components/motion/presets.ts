// One physics for the whole app: every entrance, cascade, and reveal uses
// these springs so motion feels like a single instrument.
export const SPRING = { type: 'spring', stiffness: 260, damping: 26 } as const
export const SPRING_SOFT = { type: 'spring', stiffness: 170, damping: 26 } as const
