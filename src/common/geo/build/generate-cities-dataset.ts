import { execFileSync } from 'child_process';
import { createWriteStream, existsSync, readFileSync, writeFileSync } from 'fs';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

// Dev-only data-prep step for the bundled GeoNames dataset - see
// src/assets/geonames/README.md for the short version (source, when to
// refresh, how to run). Full rationale below.
//
// Never run automatically (not part of `npm install`, `npm run build`, or
// app startup) and never invoked at runtime (see city-directory.ts's own
// comment: this app is offline/bundled-data only, no GeoNames Web API
// calls ever). Run manually via `npm run geonames:build`:
//   - once, if `src/assets/geonames/geonames-cities.json` is ever missing
//     (it is committed to the repo, so normally this never applies);
//   - again later, whenever refreshed place data is actually wanted (e.g.
//     new administrative seats, renamed places) - there is no fixed
//     schedule; GeoNames itself republishes these files roughly monthly,
//     so refreshing more often than that has no effect.
//
// Downloads two official GeoNames export/dump files (CC BY 4.0 -
// https://download.geonames.org/export/dump/readme.txt) - a one-time
// network fetch of static bulk files, not a call to the GeoNames Web API
// (api.geonames.org, the query-based REST service this project
// deliberately never uses):
//
//   - cities1000.zip - "all cities with a population > 1000 or seats of
//     adm div down to PPLA3 (ca 130.000)" - the smallest official GeoNames
//     tier that matches this project's previous dataset (the `cities.json`
//     npm package this replaces documented the exact same criteria,
//     confirming it was itself built from this same file), so this is the
//     minimal official file that preserves current functionality. Each row
//     already carries a stable `geonameid` and a flat, comma-separated
//     `alternatenames` column (untagged by language, but - per GeoNames'
//     own readme - "sufficient" for anything that doesn't need to know
//     *which* language a name variant is in, which matches this project's
//     need: searching "Warszawa" and "Warsaw" both resolving to the same
//     geonameId, not picking a "preferred" localized display name - see
//     city-directory.ts for that distinction).
//   - admin1CodesASCII.txt - English admin1 (region) names, keyed
//     `${country}.${admin1Code}`, used here at build time to resolve each
//     city's `region` once, rather than shipping the raw code table and
//     re-resolving it on every server start.
//
// Output: a single compact JSON array
// (src/assets/geonames/geonames-cities.json - a project-wide static-assets
// location, not this module, since it is a generated build artifact rather
// than source code), the one and only file the running app reads (see
// city-directory.ts) - no raw GeoNames files, and no second admin1 lookup
// table, ship with the app.
const CITIES_ZIP_URL =
  'https://download.geonames.org/export/dump/cities1000.zip';
const ADMIN1_URL =
  'https://download.geonames.org/export/dump/admin1CodesASCII.txt';

const OUTPUT_PATH = join(
  __dirname,
  '../../../assets/geonames/geonames-cities.json',
);

interface OutputCityRecord {
  geonameId: number;
  name: string;
  alternateNames: string[];
  country: string;
  region: string | null;
}

async function download(url: string, destination: string): Promise<void> {
  const response = await fetch(url);
  if (!response.ok || !response.body) {
    throw new Error(`Failed to download ${url}: HTTP ${response.status}`);
  }
  await new Promise<void>((resolve, reject) => {
    const file = createWriteStream(destination);
    // Node's global fetch Response.body is a web ReadableStream - pipe it
    // through Buffer chunks rather than assuming a Node Readable.
    const reader = response.body!.getReader();
    const pump = (): void => {
      reader
        .read()
        .then(({ done, value }) => {
          if (done) {
            file.end();
            return;
          }
          file.write(Buffer.from(value));
          pump();
        })
        .catch(reject);
    };
    file.on('finish', resolve);
    file.on('error', reject);
    pump();
  });
}

function unzip(zipPath: string, destinationDir: string): void {
  // Shells out to the system `unzip` - a dev-machine/CI tool, never a
  // runtime dependency of the app itself (this script is never imported by
  // app code - see this file's own top comment).
  execFileSync('unzip', ['-o', zipPath, '-d', destinationDir], {
    stdio: 'inherit',
  });
}

function parseAdmin1(path: string): Map<string, string> {
  const regionNameByCode = new Map<string, string>();
  const lines = readFileSync(path, 'utf8').split('\n');
  for (const line of lines) {
    if (!line.trim()) continue;
    const [code, name] = line.split('\t');
    regionNameByCode.set(code, name);
  }
  return regionNameByCode;
}

function parseCities(
  path: string,
  regionNameByCode: Map<string, string>,
): OutputCityRecord[] {
  const records: OutputCityRecord[] = [];
  const lines = readFileSync(path, 'utf8').split('\n');

  for (const line of lines) {
    if (!line.trim()) continue;
    const columns = line.split('\t');
    // Column order per the official 'geoname' table - see this file's own
    // top comment and https://download.geonames.org/export/dump/readme.txt
    const geonameId = Number(columns[0]);
    const name = columns[1];
    const alternateNamesRaw = columns[3];
    const country = columns[8];
    const admin1Code = columns[10];

    const region = admin1Code
      ? (regionNameByCode.get(`${country}.${admin1Code}`) ?? null)
      : null;

    // Deduplicated, and excludes exact (case-sensitive) repeats of `name`
    // itself - GeoNames' alternatenames column already includes the
    // primary name among the variants, which would otherwise be a
    // pointless, never-useful duplicate entry in every single record.
    const alternateNames = alternateNamesRaw
      ? [...new Set(alternateNamesRaw.split(','))].filter(
          (alt) => alt.length > 0 && alt !== name,
        )
      : [];

    records.push({ geonameId, name, alternateNames, country, region });
  }

  return records;
}

async function main(): Promise<void> {
  const workDir = mkdtempSync(join(tmpdir(), 'geonames-build-'));
  console.log(`Working directory: ${workDir}`);

  const zipPath = join(workDir, 'cities1000.zip');
  const admin1Path = join(workDir, 'admin1CodesASCII.txt');

  console.log('Downloading cities1000.zip ...');
  await download(CITIES_ZIP_URL, zipPath);
  console.log('Downloading admin1CodesASCII.txt ...');
  await download(ADMIN1_URL, admin1Path);

  console.log('Extracting cities1000.zip ...');
  unzip(zipPath, workDir);

  const citiesTxtPath = join(workDir, 'cities1000.txt');
  if (!existsSync(citiesTxtPath)) {
    throw new Error(`Expected ${citiesTxtPath} after extracting the zip`);
  }

  console.log('Parsing admin1CodesASCII.txt ...');
  const regionNameByCode = parseAdmin1(admin1Path);

  console.log('Parsing cities1000.txt ...');
  const records = parseCities(citiesTxtPath, regionNameByCode);
  console.log(`Parsed ${records.length} city records.`);

  writeFileSync(OUTPUT_PATH, JSON.stringify(records));
  console.log(`Wrote ${OUTPUT_PATH}`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
