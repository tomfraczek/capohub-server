import { Module } from '@nestjs/common';
import { ImageAssetService } from './image-asset.service';
import { ImageProcessingService } from './image-processing.service';
import { r2ClientProvider } from './r2-client.provider';
import { R2StorageService } from './r2-storage.service';

// Cloudflare R2 (S3-compatible) image storage for User/Group/Section/Event
// images - see r2-storage.service.ts, image-processing.service.ts and
// image-asset.service.ts for the three-way split this module keeps
// (low-level R2 client / pixel processing / replace-delete choreography).
// Not @Global() - UsersModule, GroupsModule and EventsModule each import
// it explicitly, the same convention ClerkModule already uses for a
// similarly cross-cutting, externally-backed concern.
@Module({
  providers: [
    r2ClientProvider,
    R2StorageService,
    ImageProcessingService,
    ImageAssetService,
  ],
  exports: [R2StorageService, ImageProcessingService, ImageAssetService],
})
export class StorageModule {}
