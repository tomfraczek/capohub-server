import { resolve } from 'node:path';
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { EntityManager } from '@mikro-orm/postgresql';
import { AppModule } from '../../../app.module';
import { AppConfigService } from '../../../config/app.config';
import { SongContentService } from '../../../songs/song-content.service';
import { validateSongImportDataset } from './song-import.schema';
import {
  SongTranslationSyncResult,
  SongTranslationSyncStatus,
  syncSongTranslations,
} from './song-translation-sync';
import {
  importSongs,
  loadSongImportFiles,
  SongImportResult,
  SongImportStatus,
  SongImportVerification,
  verifyImportedSongs,
} from './song-import';

const CONTEXT = 'ImportSongs';
const DEFAULT_DIRECTORY = 'songs';

interface CliOptions {
  directory: string;
  dryRun: boolean;
  verifyOnly: boolean;
  syncTranslations: boolean;
  allowProduction: boolean;
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    directory: DEFAULT_DIRECTORY,
    dryRun: false,
    verifyOnly: false,
    syncTranslations: false,
    allowProduction: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--dir') {
      options.directory = argv[++i] ?? DEFAULT_DIRECTORY;
    } else if (arg === '--dry-run') {
      options.dryRun = true;
    } else if (arg === '--verify-only') {
      options.verifyOnly = true;
    } else if (arg === '--sync-translations') {
      options.syncTranslations = true;
    } else if (arg === '--allow-production') {
      options.allowProduction = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return options;
}

// host:port/database only - never the credentials part of DATABASE_URL.
function describeDatabase(databaseUrl: string): string {
  const url = new URL(databaseUrl);
  return `${url.hostname}:${url.port || '5432'}${url.pathname}`;
}

function printImportResults(results: SongImportResult[]): void {
  results.forEach((result, index) => {
    const line = `${String(index + 1).padStart(2)}. [${result.status}] ${result.title} (${result.source})${result.songId ? ` -> ${result.songId}` : ''}`;
    if (
      result.status === SongImportStatus.FAILED ||
      result.status === SongImportStatus.SKIPPED_MODIFIED ||
      result.status === SongImportStatus.SKIPPED_TITLE_COLLISION
    ) {
      Logger.warn(line, CONTEXT);
      if (result.detail) Logger.warn(`    ${result.detail}`, CONTEXT);
      for (const difference of result.differences) {
        Logger.warn(`    - ${difference}`, CONTEXT);
      }
    } else {
      Logger.log(line, CONTEXT);
    }
  });

  const totals = new Map<SongImportStatus, number>();
  for (const result of results) {
    totals.set(result.status, (totals.get(result.status) ?? 0) + 1);
  }
  Logger.log(
    `Summary: ${[...totals].map(([status, count]) => `${status}=${count}`).join(', ')}`,
    CONTEXT,
  );
}

function printSyncResults(results: SongTranslationSyncResult[]): void {
  results.forEach((result, index) => {
    const line = `${String(index + 1).padStart(2)}. [${result.status}] ${result.title} (${result.source})${result.songId ? ` -> ${result.songId}` : ''}`;
    const isProblem =
      result.status === SongTranslationSyncStatus.FAILED ||
      result.status === SongTranslationSyncStatus.NOT_FOUND ||
      result.status.startsWith('CONFLICT');
    const log = isProblem ? Logger.warn.bind(Logger) : Logger.log.bind(Logger);
    log(line, CONTEXT);
    if (result.detail) log(`    ${result.detail}`, CONTEXT);
    for (const change of result.changes) log(`    - ${change}`, CONTEXT);
  });

  const totals = new Map<SongTranslationSyncStatus, number>();
  for (const result of results) {
    totals.set(result.status, (totals.get(result.status) ?? 0) + 1);
  }
  Logger.log(
    `Sync summary: ${[...totals].map(([status, count]) => `${status}=${count}`).join(', ')}`,
    CONTEXT,
  );
}

function printVerification(verification: SongImportVerification): void {
  for (const song of verification.songs) {
    const counts = song.actual
      ? `parts=${song.actual.parts} lines=${song.actual.lines} pl=${song.actual.translations} media=${song.actual.media} alt=${song.actual.alternativeTitles}`
      : 'not found';
    if (song.problems.length === 0) {
      Logger.log(`OK   ${song.title} - ${counts}`, CONTEXT);
    } else {
      Logger.error(`FAIL ${song.title} - ${counts}`, CONTEXT);
      for (const problem of song.problems) {
        Logger.error(`    - ${problem}`, CONTEXT);
      }
    }
  }
  for (const problem of verification.integrityProblems) {
    Logger.error(`Integrity: ${problem}`, CONTEXT);
  }
  Logger.log(
    `Verification ${verification.ok ? 'passed' : 'FAILED'}: ${verification.songs.filter((s) => s.problems.length === 0).length}/${verification.songs.length} song(s) match the source files`,
    CONTEXT,
  );
}

async function run(): Promise<boolean> {
  const options = parseArgs(process.argv.slice(2));
  const directory = resolve(process.cwd(), options.directory);

  // Validate the files before even booting the app - a broken file must
  // never get as far as a database connection.
  const files = loadSongImportFiles(directory);
  const { entries, errors } = validateSongImportDataset(files);
  if (errors.length > 0) {
    for (const error of errors) Logger.error(error, CONTEXT);
    Logger.error(
      `${errors.length} validation error(s) in ${directory} - nothing was imported`,
      CONTEXT,
    );
    return false;
  }
  Logger.log(
    `Validated ${entries.length} song(s) from ${files.length} file(s) in ${directory}`,
    CONTEXT,
  );

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  });
  try {
    const config = app.get(AppConfigService);
    Logger.log(
      `Target database: ${describeDatabase(config.databaseUrl)} (NODE_ENV=${config.nodeEnv})`,
      CONTEXT,
    );
    if (
      config.isProduction &&
      !options.allowProduction &&
      !options.verifyOnly
    ) {
      Logger.error(
        'Refusing to write to a production database without --allow-production',
        CONTEXT,
      );
      return false;
    }

    const em = app.get(EntityManager).fork();

    if (options.syncTranslations && !options.verifyOnly) {
      const results = await syncSongTranslations(em, entries, {
        dryRun: options.dryRun,
      });
      printSyncResults(results);
      if (options.dryRun) {
        return true;
      }
    } else if (!options.verifyOnly) {
      const results = await importSongs(
        em,
        app.get(SongContentService),
        entries,
        { dryRun: options.dryRun },
      );
      printImportResults(results);
      if (options.dryRun) {
        return true;
      }
      if (results.some((r) => r.status === SongImportStatus.FAILED)) {
        Logger.error('Some songs failed to import (see above)', CONTEXT);
      }
    }

    const verification = await verifyImportedSongs(em.fork(), entries);
    printVerification(verification);
    return verification.ok;
  } finally {
    await app.close();
  }
}

if (require.main === module) {
  run()
    .then((ok) => {
      process.exitCode = ok ? 0 : 1;
    })
    .catch((error: unknown) => {
      Logger.error(
        error instanceof Error ? (error.stack ?? error.message) : String(error),
        CONTEXT,
      );
      process.exitCode = 1;
    });
}
