import { Module } from '@nestjs/common';
import { GroupsModule } from '../groups/groups.module';
import { StorageModule } from '../storage/storage.module';
import { CitySearchService } from './city-search.service';
import { DiscoveryController } from './discovery.controller';
import { DiscoveryService } from './discovery.service';

@Module({
  // StorageModule is imported for resolving Group/Section/User image URLs
  // (profileImageKey/avatarImageKey over the legacy logoUrl/avatarUrl
  // columns) in resolveByCode/search - see discovery.service.ts.
  imports: [GroupsModule, StorageModule],
  controllers: [DiscoveryController],
  providers: [DiscoveryService, CitySearchService],
})
export class DiscoveryModule {}
