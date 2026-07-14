import 'dotenv/config';
import { validateEnv } from '../config/env.schema';
import { buildMikroOrmOptions } from './mikro-orm-options.factory';

// Entry point read by the MikroORM CLI (see the "mikro-orm.configPaths" entry
// in package.json). Not imported by DatabaseModule or by any unit test, since
// this is the only place allowed to read process.env eagerly at import time.
const env = validateEnv(process.env);

export default buildMikroOrmOptions({
  databaseUrl: env.DATABASE_URL,
  databaseSsl: env.DATABASE_SSL,
  debug: env.NODE_ENV === 'development',
});
