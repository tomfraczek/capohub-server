import { Module } from '@nestjs/common';
import { GroupsModule } from '../groups/groups.module';
import { CitySearchService } from './city-search.service';
import { DiscoveryController } from './discovery.controller';
import { DiscoveryService } from './discovery.service';

@Module({
  imports: [GroupsModule],
  controllers: [DiscoveryController],
  providers: [DiscoveryService, CitySearchService],
})
export class DiscoveryModule {}
