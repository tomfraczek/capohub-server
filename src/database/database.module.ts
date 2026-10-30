import { Module } from '@nestjs/common';
import { MikroOrmModule } from '@mikro-orm/nestjs';
import { PostgreSqlDriver } from '@mikro-orm/postgresql';
import { AppConfigService } from '../config/app.config';
import { buildMikroOrmOptions } from './mikro-orm-options.factory';
import { DatabaseHealthService } from './health/database-health.service';

@Module({
  imports: [
    MikroOrmModule.forRootAsync({
      driver: PostgreSqlDriver,
      inject: [AppConfigService],
      useFactory: (appConfig: AppConfigService) =>
        buildMikroOrmOptions({
          databaseUrl: appConfig.databaseUrl,
          databaseSsl: appConfig.databaseSsl,
          databaseCaCert: appConfig.databaseCaCert,
          debug: appConfig.isDevelopment,
        }),
    }),
  ],
  providers: [DatabaseHealthService],
  exports: [DatabaseHealthService],
})
export class DatabaseModule {}
