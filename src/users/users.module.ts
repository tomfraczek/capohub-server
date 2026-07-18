import { Module } from '@nestjs/common';
import { MikroOrmModule } from '@mikro-orm/nestjs';
import { ClerkModule } from '../auth/clerk/clerk.module';
import { SongLibraryModule } from '../song-library/song-library.module';
import { User } from './entities/user.entity';
import { UserService } from './user.service';
import { UsersController } from './users.controller';

@Module({
  // SongLibraryModule is imported for GET /users/me/favorite-songs and
  // /users/me/learning-songs - one-directional, SongLibraryModule never
  // imports UsersModule back.
  imports: [MikroOrmModule.forFeature([User]), ClerkModule, SongLibraryModule],
  controllers: [UsersController],
  providers: [UserService],
  exports: [UserService],
})
export class UsersModule {}
