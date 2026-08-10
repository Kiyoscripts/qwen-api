import { Shell } from "./Shell";
import { Hero } from "./Hero";
import { Makers } from "./Makers";
import { Stats } from "./Stats";
import { Quickstart } from "./Quickstart";
import { Grid } from "./Grid";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Five sections, five different layout families: asymmetric split, logo row,
 * figures on rules, full-width code, then an uneven grid. No two read the same
 * way, and none of them carries an eyebrow.
 */
export default function HomePage() {
  return (
    <Shell>
      <Hero />
      <Makers />
      <Stats />
      <Quickstart />
      <Grid />
    </Shell>
  );
}
