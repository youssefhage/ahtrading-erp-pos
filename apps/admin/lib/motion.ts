/**
 * Centralized animation variants for the admin portal.
 * Uses `motion` (lightweight ~4KB, same API as framer-motion).
 *
 * All durations are 150–200ms for snappy feel.
 * Respects `prefers-reduced-motion` via the `useReducedMotion` hook.
 */

import type { Transition, Variants } from "motion/react";

/* ------------------------------------------------------------------ */
/*  Spring configs                                                     */
/* ------------------------------------------------------------------ */

export const springSnappy: Transition = {
  type: "spring",
  stiffness: 500,
  damping: 30,
  mass: 1,
};

export const springGentle: Transition = {
  type: "spring",
  stiffness: 300,
  damping: 25,
  mass: 0.8,
};

/* ------------------------------------------------------------------ */
/*  Ease configs                                                       */
/* ------------------------------------------------------------------ */

export const easeOut: Transition = { duration: 0.15, ease: [0.25, 0.46, 0.45, 0.94] };
export const easeInOut: Transition = { duration: 0.2, ease: [0.4, 0, 0.2, 1] };

/* ------------------------------------------------------------------ */
/*  Variants                                                           */
/* ------------------------------------------------------------------ */

export const fadeIn: Variants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { duration: 0.15 } },
  exit: { opacity: 0, transition: { duration: 0.1 } },
};

export const fadeSlideUp: Variants = {
  hidden: { opacity: 0, y: 8 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.2, ease: [0.25, 0.46, 0.45, 0.94] } },
  exit: { opacity: 0, y: -4, transition: { duration: 0.1 } },
};

export const fadeSlideRight: Variants = {
  hidden: { opacity: 0, x: -8 },
  visible: { opacity: 1, x: 0, transition: { duration: 0.15, ease: [0.25, 0.46, 0.45, 0.94] } },
  exit: { opacity: 0, x: 8, transition: { duration: 0.1 } },
};

export const scaleIn: Variants = {
  hidden: { opacity: 0, scale: 0.95 },
  visible: { opacity: 1, scale: 1, transition: { duration: 0.15 } },
  exit: { opacity: 0, scale: 0.95, transition: { duration: 0.1 } },
};

/* ------------------------------------------------------------------ */
/*  Stagger containers                                                 */
/* ------------------------------------------------------------------ */

export const staggerContainer: Variants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      staggerChildren: 0.04,
      delayChildren: 0.02,
    },
  },
};

export const staggerItem: Variants = {
  hidden: { opacity: 0, y: 6 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.15, ease: [0.25, 0.46, 0.45, 0.94] },
  },
};

/* ------------------------------------------------------------------ */
/*  Collapsible height animation                                       */
/* ------------------------------------------------------------------ */

export const collapseVariants: Variants = {
  open: {
    height: "auto",
    opacity: 1,
    transition: { duration: 0.2, ease: [0.25, 0.46, 0.45, 0.94] },
  },
  closed: {
    height: 0,
    opacity: 0,
    transition: { duration: 0.15, ease: [0.25, 0.46, 0.45, 0.94] },
  },
};
