import { motion, useReducedMotion } from "motion/react";

/**
 * Enter-on-scroll.
 *
 * Justification for the motion: sections carry a reading order, and a short
 * rise as each one arrives marks where the eye should start. It fires once and
 * never loops, so nothing on the page is perpetually moving.
 */
export function Reveal({
  children,
  delay = 0,
  y = 18,
  className,
}: {
  children: React.ReactNode;
  delay?: number;
  y?: number;
  className?: string;
}) {
  const reduce = useReducedMotion();
  return (
    <motion.div
      className={className}
      initial={reduce ? false : { opacity: 0, y }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.25 }}
      transition={{ duration: 0.62, delay, ease: [0.16, 1, 0.3, 1] }}
    >
      {children}
    </motion.div>
  );
}
