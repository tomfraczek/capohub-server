import 'dotenv/config';
import { validateDatabaseEnv } from '../config/database-env.schema';
import { buildMikroOrmOptions } from './mikro-orm-options.factory';

// Entry point read by the MikroORM CLI (see the "mikro-orm.configPaths" entry
// in package.json). Not imported by DatabaseModule or by any unit test, since
// this is the only place allowed to read process.env eagerly at import time.
// Validates only the database slice of the environment - migrations have no
// use for Clerk/R2/CORS, but get the same SSL/CA/production rules as the app.
const env = validateDatabaseEnv(process.env);

export default buildMikroOrmOptions({
  databaseUrl: env.DATABASE_URL,
  databaseSsl: env.DATABASE_SSL,
  databaseCaCert: env.DATABASE_CA_CERT,
  debug: env.NODE_ENV === 'development',
});
