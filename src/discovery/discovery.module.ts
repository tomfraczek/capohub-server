import { Module } from '@nestjs/common';
import { CitySearchService } from './city-search.service';
import { DiscoveryController } from './discovery.controller';
import { DiscoveryService } from './discovery.service';

@Module({
  controllers: [DiscoveryController],
  providers: [DiscoveryService, CitySearchService],
})
export class DiscoveryModule {}
