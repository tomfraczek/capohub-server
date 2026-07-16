import { User } from '../../users/entities/user.entity';
import { SongStatus } from '../enums/song-status.enum';
import { SongCategory } from './song-category.entity';
import { Song } from './song.entity';

describe('Song', () => {
  it('defaults status to DRAFT', () => {
    const song = new Song();
    expect(song.status).toBe(SongStatus.DRAFT);
  });

  it('defaults authorName and createdBy to null', () => {
    const song = new Song();
    expect(song.authorName).toBeNull();
    expect(song.createdBy).toBeNull();
  });

  it('keeps authorName (the song writer) and createdBy (the CapoHub user) independent', () => {
    const song = new Song();
    const user = new User();
    song.authorName = 'Mestre Bimba';
    song.createdBy = user;

    expect(song.authorName).toBe('Mestre Bimba');
    expect(song.createdBy).toBe(user);
  });

  it('accepts a null authorName alongside a set createdBy (traditional song, known contributor)', () => {
    const song = new Song();
    const user = new User();
    song.authorName = null;
    song.createdBy = user;

    expect(song.authorName).toBeNull();
    expect(song.createdBy).toBe(user);
  });

  it('assigns exactly one category', () => {
    const song = new Song();
    const category = new SongCategory();
    song.category = category;

    expect(song.category).toBe(category);
  });

  it('initializes empty ordered collections for a new instance', () => {
    const song = new Song();
    expect(song.alternativeTitles.length).toBe(0);
    expect(song.parts.length).toBe(0);
    expect(song.tags.length).toBe(0);
    expect(song.media.length).toBe(0);
  });
});
