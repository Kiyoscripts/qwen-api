import { Shell } from "./syde/Shell";
import { Hero } from "./syde/Hero";
import { Makers } from "./syde/Makers";
import { Stats } from "./syde/Stats";
import { Quickstart } from "./syde/Quickstart";
import { Grid } from "./syde/Grid";

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
