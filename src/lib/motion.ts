/**
 * Mireli motion system — the single source of truth for animation.
 *
 * The 20 rules this module encodes:
 *  1.  Ease-out for entrances
 *  2.  Dropdowns at 150-250ms
 *  3.  Stagger list rows by 30ms
 *  4.  Scale to 0.97 on press
 *  5.  Stretch moving knobs 12%
 *  6.  Stagger as details settle
 *  7.  Arcs for object movement
 *  8.  Pulse to confirm success
 *  9.  Ease-in-out for moves
 *  10. Start popovers at 0.95
 *  11. Enter from the trigger
 *  12. Exit to the trigger
 *  13. No bounce on everyday UI
 *  14. Don't tween while held
 *  15. Make exits 20% shorter
 *  16. Overlap old & new states
 *  17. Masks for reveals & colour
 *  18. Crossfade icons + blur
 *  19. Rubber band past bounds
 *  20. Reuse the same layoutId
 *
 * Import tokens from here; never hand-write durations/eases in components.
 */
import type { Transition, Variants } from "framer-motion";

/* ------------------------------------------------------------------ */
/* Easing (rules 1, 9, 13)                                             */
/* ------------------------------------------------------------------ */

/** Rule 1 — entrances decelerate. */
export const EASE_OUT = [0.16, 1, 0.3, 1] as const;

/** Rule 9 — position moves (knobs, layout shifts) ease in-out. */
export const EASE_IN_OUT = [0.45, 0, 0.55, 1] as const;

/** Rule 13 — no spring/bounce anywhere in everyday UI. Never use `spring`. */
export const NO_BOUNCE: Transition = { ease: EASE_IN_OUT };

/* ------------------------------------------------------------------ */
/* Durations (rules 2, 15)                                             */
/* ------------------------------------------------------------------ */

export const DURATION = {
  /** Rule 2 — dropdowns/popovers land inside 150-250ms. */
  dropdown: 0.18,
  /** Standard state change (pills, toggles, colour). */
  state: 0.2,
  /** Entrances and layout moves. */
  move: 0.24,
  /** Rule 15 — exits are 20% shorter than their entrance/move counterpart. */
  exit: 0.19,
  /** Press feedback (rule 14 — instant, no tween while held). */
  press: 0.075,
} as const;

/** Rule 3 — list rows stagger by 30ms. */
export const STAGGER_MS = 0.03;

/* ------------------------------------------------------------------ */
/* Scales (rules 4, 5, 10, 19)                                         */
/* ------------------------------------------------------------------ */

/** Rule 4 — pressed controls compress to 0.97. */
export const PRESS_SCALE = 0.97;

/** Rule 5 — a moving knob stretches 12% along its travel axis. */
export const KNOB_STRETCH = 1.12;

/** Rule 10 — popovers/dropdowns start at 0.95 scale, anchored to trigger. */
export const POPOVER_START_SCALE = 0.95;

/** Rule 19 — rubber-band overshoot factor for pull-past-bounds gestures. */
export const RUBBER_BAND_OVERSHOOT = 0.08;

/* ------------------------------------------------------------------ */
/* Variants                                                            */
/* ------------------------------------------------------------------ */

/**
 * Rules 1 + 15 — standard list-row / panel entrance: fade + rise with
 * ease-out; the paired exit is 20% shorter.
 */
export const rowVariants: Variants = {
  hidden: { opacity: 0, y: 10 },
  show: {
    opacity: 1,
    y: 0,
    transition: { duration: DURATION.move, ease: EASE_OUT },
  },
  exit: {
    opacity: 0,
    y: 6,
    transition: { duration: DURATION.exit, ease: EASE_IN_OUT },
  },
};

/** Rule 3 — parent wrapper that staggers `rowVariants` children by 30ms. */
export const staggeredList: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: STAGGER_MS } },
};

/**
 * Rules 6 + 16 — details settle after the container: children arrive on a
 * delayed stagger so old and new states visibly overlap during handoff.
 */
export const settleStagger = (delayBase = 0.06): Variants => ({
  hidden: {},
  show: { transition: { staggerChildren: STAGGER_MS, delayChildren: delayBase } },
});

/**
 * Rules 10 + 11 + 12 + 2 — popover/dropdown content: starts at 0.95 scale,
 * enters from and exits toward the trigger, inside the 150-250ms window.
 * `originY`/`originX` set transform-origin toward the trigger edge.
 */
export const popoverVariants: Variants = {
  hidden: { opacity: 0, scale: POPOVER_START_SCALE, y: -4 },
  show: {
    opacity: 1,
    scale: 1,
    y: 0,
    transition: { duration: DURATION.dropdown, ease: EASE_OUT },
  },
  exit: {
    opacity: 0,
    scale: POPOVER_START_SCALE,
    y: -4,
    transition: { duration: DURATION.dropdown * 0.8, ease: EASE_IN_OUT },
  },
};

/**
 * Rule 8 — success confirmation: one pulse (scale up and settle), no bounce.
 * Drive it by keying the element on the success state so it remounts.
 */
export const successPulse: Variants = {
  hidden: { scale: 1 },
  show: {
    scale: [1, 1.06, 1],
    transition: { duration: 0.32, times: [0, 0.45, 1], ease: EASE_OUT },
  },
};

/**
 * Rule 18 — icon crossfade with a slight blur during the swap. Wrap both
 * icons in a shared absolutely-positioned slot and key them.
 */
export const iconCrossfade: Variants = {
  hidden: { opacity: 0, filter: "blur(3px)", scale: 0.96 },
  show: {
    opacity: 1,
    filter: "blur(0px)",
    scale: 1,
    transition: { duration: DURATION.state, ease: EASE_OUT },
  },
  exit: {
    opacity: 0,
    filter: "blur(3px)",
    scale: 0.96,
    transition: { duration: DURATION.exit, ease: EASE_IN_OUT },
  },
};

/**
 * Rules 7 + 9 — object movement along an arc: animate x and y on separate
 * timing curves so the path bows instead of cutting the diagonal.
 */
export const arcMove = (bow = 24): { x: Transition; y: Transition; bow: number } => ({
  // x runs the full duration on ease-in-out; y leads slightly with ease-out,
  // so the path bows instead of cutting the diagonal. Apply `bow` as the y
  // offset at the midpoint (e.g. via a keyframe array on the moving element).
  x: { duration: DURATION.move, ease: EASE_IN_OUT },
  y: { duration: DURATION.move * 0.9, ease: EASE_OUT },
  bow,
});

/**
 * Rules 11 + 12 — sheets/dialogs enter from and exit toward their trigger
 * edge. Use `fromEdge` for the direction the trigger sits in.
 */
export type Edge = "bottom" | "top" | "left" | "right";
export const fromEdge = (edge: Edge): Variants => {
  const offset = { bottom: { y: 24 }, top: { y: -24 }, left: { x: -24 }, right: { x: 24 } }[edge];
  return {
    hidden: { opacity: 0, ...offset },
    show: { opacity: 1, x: 0, y: 0, transition: { duration: DURATION.move, ease: EASE_OUT } },
    exit: { opacity: 0, ...offset, transition: { duration: DURATION.exit, ease: EASE_IN_OUT } },
  };
};

/**
 * Rule 17 — reveal through a mask: clip-path wipe rather than a fade, for
 * colour changes and panel reveals.
 */
export const maskReveal: Variants = {
  hidden: { clipPath: "inset(0 0 100% 0)" },
  show: {
    clipPath: "inset(0 0 0% 0)",
    transition: { duration: DURATION.move, ease: EASE_OUT },
  },
  exit: {
    clipPath: "inset(100% 0 0 0)",
    transition: { duration: DURATION.exit, ease: EASE_IN_OUT },
  },
};

/* ------------------------------------------------------------------ */
/* Shared layout ids (rule 20)                                         */
/* ------------------------------------------------------------------ */

/** Rule 20 — one layoutId per morphing element, defined once here. */
export const LAYOUT_ID = {
  directionPill: "direction-pill",
  methodToggleKnob: "pay-method-knob",
  navPill: "mireli-nav-pill",
} as const;

/* ------------------------------------------------------------------ */
/* CSS helpers (rules 4 + 14) — see globals.css                        */
/* ------------------------------------------------------------------ */

/**
 * Rules 4 + 14 — press feedback as a Tailwind class string. `active:` keeps
 * the tween off while held (the scale applies instantly on press, releases
 * with the short duration).
 */
export const pressClass =
  "transition-transform active:scale-[0.97] active:duration-75 duration-200";
