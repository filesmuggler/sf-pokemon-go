import "./load-env";
import { readFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { bulkIndexCases, ensureIndex } from "@/lib/elastic/index";
import { iterateSodaCases } from "@/lib/sf311/soda";
import { normalizeSodaRow } from "@/lib/sf311/normalize";
import type { SF311Case, SodaRow } from "@/lib/sf311/types";

/**
 * Seed the index with SF 311 cases.
 *
 *   npm run es:seed                      # last 30 days, up to 5000 cases citywide
 *   npm run es:seed -- --days 90 --limit 20000
 *   npm run es:seed -- --lat 37.7599 --lon -122.4148 --radius 1500   # one neighborhood
 *   npm run es:seed -- --sample          # bundled synthetic sample, no network needed
 */
async function main() {
  const { values } = parseArgs({
    options: {
      days: { type: "string", default: "30" },
      limit: { type: "string", default: "5000" },
      lat: { type: "string" },
      lon: { type: "string" },
      radius: { type: "string", default: "1500" },
      sample: { type: "boolean", default: false },
    },
  });

  await ensureIndex();

  if (values.sample) {
    const raw = await readFile(new URL("./data/sample-311.json", import.meta.url), "utf8");
    const rows = JSON.parse(raw) as SodaRow[];
    const cases = rows.map(normalizeSodaRow).filter((c): c is SF311Case => c !== null);
    const { indexed, failed } = await bulkIndexCases(cases);
    console.log(`Indexed ${indexed} sample cases (${failed} failed).`);
    return;
  }

  const center =
    values.lat && values.lon
      ? { lat: Number(values.lat), lon: Number(values.lon), radiusM: Number(values.radius) }
      : undefined;

  console.log(
    `Fetching 311 cases from data.sf.gov — last ${values.days} days, limit ${values.limit}${
      center ? `, within ${center.radiusM} m of ${center.lat},${center.lon}` : ""
    }`,
  );

  let total = 0;
  let failedTotal = 0;
  for await (const page of iterateSodaCases({
    days: Number(values.days),
    limit: Number(values.limit),
    center,
    onPage: (n) => console.log(`  fetched ${n} rows…`),
  })) {
    const { indexed, failed } = await bulkIndexCases(page);
    total += indexed;
    failedTotal += failed;
  }
  console.log(`Done. Indexed ${total} cases (${failedTotal} failed).`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
