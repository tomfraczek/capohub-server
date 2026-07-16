import { SongPerformer } from '../enums/song-performer.enum';
import { SongPart } from './song-part.entity';

describe('SongPart', () => {
  it('accepts LEAD as performer', () => {
    const part = new SongPart();
    part.performer = SongPerformer.LEAD;
    expect(part.performer).toBe(SongPerformer.LEAD);
  });

  it('accepts CHORUS as performer', () => {
    const part = new SongPart();
    part.performer = SongPerformer.CHORUS;
    expect(part.performer).toBe(SongPerformer.CHORUS);
  });

  it('initializes an empty ordered lines collection for a new instance', () => {
    const part = new SongPart();
    expect(part.lines.length).toBe(0);
  });
});
