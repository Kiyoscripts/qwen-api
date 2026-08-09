/**
 * Enter-on-scroll.
 *
 * Deliberately not a client component any more. The previous version used
 * Motion's whileInView, which renders the element at opacity 0 and relies on
 * JavaScript to bring it back: if hydration stalled, or the tab was in the
 * background where requestAnimationFrame is throttled, the content stayed
 * invisible. That is the wrong failure direction for body copy.
 *
 * Now the reveal is a CSS scroll-driven animation, applied only where the
 * browser supports it. Everywhere else the content is simply visible, and no
 * script is involved either way.
 */
export function Reveal({
  children,
  delay = 0,
  className,
}: {
  children: React.ReactNode;
  delay?: number;
  y?: number;
  className?: string;
}) {
  return (
    <div
      className={`reveal${className ? ` ${className}` : ""}`}
      style={delay ? { animationDelay: `${delay}s` } : undefined}
    >
      {children}
    </div>
  );
}
