import { Module } from '@nestjs/common';
import { MikroOrmModule } from '@mikro-orm/nestjs';
import { ClerkModule } from '../auth/clerk/clerk.module';
import { EventsModule } from '../events/events.module';
import { GroupsModule } from '../groups/groups.module';
import { SongLibraryModule } from '../song-library/song-library.module';
import { User } from './entities/user.entity';
import { UserService } from './user.service';
import { UsersController } from './users.controller';

@Module({
  // SongLibraryModule is imported for GET /users/me/favorite-songs and
  // /users/me/learning-songs - one-directional, SongLibraryModule never
  // imports UsersModule back. GroupsModule is imported so UserService can
  // check whether the account owns any Group before DELETE /users/me hard-
  // deletes it - also one-directional (see GroupsModule's exports comment).
  // EventsModule likewise, so UserService can check whether the account
  // solely owns any live Event first (see EventRolesService.findOwnedActiveEvents).
  imports: [
    MikroOrmModule.forFeature([User]),
    ClerkModule,
    SongLibraryModule,
    GroupsModule,
    EventsModule,
  ],
  controllers: [UsersController],
  providers: [UserService],
  exports: [UserService],
})
export class UsersModule {}
