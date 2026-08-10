import { Nav } from "./Nav";
import { Footer } from "./Footer";

/**
 * The frame every ported page sits in.
 *
 * `.syde` paints its own background and text colour, so a ported page is fully
 * insulated from the old global styles while both stylesheets are loaded.
 */
export function Shell({ children, footer = true }: { children: React.ReactNode; footer?: boolean }) {
  return (
    <div className="syde">
      <div className="rules" aria-hidden>
        <div className="rules-inner">
          {Array.from({ length: 12 }).map((_, i) => <span key={i} />)}
        </div>
      </div>
      <div className="relative z-10">
        <Nav />
        <main>{children}</main>
        {footer && <Footer />}
      </div>
    </div>
  );
}
