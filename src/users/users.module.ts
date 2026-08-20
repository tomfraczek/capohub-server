import { Module } from '@nestjs/common';
import { MikroOrmModule } from '@mikro-orm/nestjs';
import { ClerkModule } from '../auth/clerk/clerk.module';
import { PermissionsModule } from '../auth/permissions/permissions.module';
import { EventsModule } from '../events/events.module';
import { GroupsModule } from '../groups/groups.module';
import { SongLibraryModule } from '../song-library/song-library.module';
import { User } from './entities/user.entity';
import { UserIdentityService } from './user-identity.service';
import { UserProfileService } from './user-profile.service';
import { UserService } from './user.service';
import { UsersController } from './users.controller';

@Module({
  // SongLibraryModule is imported for GET /users/me/favorite-songs and
  // /users/me/learning-songs - one-directional, SongLibraryModule never
  // imports UsersModule back. GroupsModule is imported so UserService can
  // check whether the account owns any Group before DELETE /users/me hard-
  // deletes it - also one-directional (see GroupsModule's exports comment).
  // UserProfileService additionally depends on GroupsModule's exported
  // GroupHierarchyService (walking a formal Group's Section subtree - see
  // UserProfileService.setFormalGroup). EventsModule likewise, so
  // UserService can check whether the account solely owns any live Event
  // first (see EventRolesService.findOwnedActiveEvents). PermissionsModule
  // is imported for PermissionService, which UsersController uses to
  // compute GET/PATCH /users/me's songCapabilities from the caller's
  // globalRole (see dto/song-capabilities.dto.ts) - no guard is needed here
  // since every route below is already scoped to "me".
  imports: [
    MikroOrmModule.forFeature([User]),
    ClerkModule,
    SongLibraryModule,
    GroupsModule,
    EventsModule,
    PermissionsModule,
  ],
  controllers: [UsersController],
  providers: [UserService, UserProfileService, UserIdentityService],
  // UserIdentityService is additionally exported so a future
  // attendance/check-in module can call resolveUserByNumericCode without
  // this module needing to change (see that service's own comment) - not
  // consumed by anything outside UsersModule yet.
  exports: [UserService, UserIdentityService],
})
export class UsersModule {}
