import { Hero } from "../sections/Hero";
import { Makers } from "../sections/Makers";
import { ModelRail } from "../sections/ModelRail";
import { Quickstart } from "../sections/Quickstart";
import { Throughput } from "../sections/Throughput";
import { Grid } from "../sections/Grid";

/**
 * Six sections, six different layout families: asymmetric split, logo row,
 * horizontal rail, full-width code, chart beside figures, then an uneven grid.
 * No two read the same way, and none of them carries an eyebrow.
 */
export function Home() {
  return (
    <>
      <Hero />
      <Makers />
      <ModelRail />
      <Quickstart />
      <Throughput />
      <Grid />
    </>
  );
}
