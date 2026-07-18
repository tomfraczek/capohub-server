import { Entity, Enum, Index, ManyToOne, Unique } from '@mikro-orm/core';
import { BaseEntity } from '../../database/entities/base.entity';
import { Song } from '../../songs/entities/song.entity';
import { User } from '../../users/entities/user.entity';
import { LearningStatus } from '../enums/learning-status.enum';

// One row per user+song tracks that user's personal learning progress -
// purely local to CapoHub, never affects the global Song model. Absence of
// a row (not NOT_STARTED) means "not tracked yet" - see
// LearningStatusService.removeStatus / DELETE .../learning-status.
@Entity({ tableName: 'user_song_learnings' })
@Unique({ properties: ['user', 'song'] })
export class UserSongLearning extends BaseEntity {
  @Index()
  @ManyToOne(() => User, { deleteRule: 'cascade' })
  user!: User;

  @Index()
  @ManyToOne(() => Song, { deleteRule: 'cascade' })
  song!: Song;

  @Enum({ items: () => Object.values(LearningStatus) })
  status: LearningStatus = LearningStatus.NOT_STARTED;
}
