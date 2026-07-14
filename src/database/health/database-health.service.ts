import { Injectable, Logger } from '@nestjs/common';
import { MikroORM } from '@mikro-orm/core';

export interface DatabaseHealthStatus {
  status: 'up' | 'down';
}

@Injectable()
export class DatabaseHealthService {
  private readonly logger = new Logger(DatabaseHealthService.name);

  constructor(private readonly orm: MikroORM) {}

  async check(): Promise<DatabaseHealthStatus> {
    const result = await this.orm.em.getConnection().checkConnection();

    if (!result.ok) {
      this.logger.error(`Database health check failed: ${result.reason}`);
      return { status: 'down' };
    }

    return { status: 'up' };
  }
}
