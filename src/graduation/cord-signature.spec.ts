import { cordSignature } from './cord-signature';

describe('cordSignature', () => {
  it('is equal for the same cord regardless of array order and hex case', () => {
    expect(
      cordSignature([
        { position: 2, colorHex: '#ffff00', proportion: 40 },
        { position: 1, colorHex: '#00FF00', proportion: 60 },
      ]),
    ).toBe(
      cordSignature([
        { position: 1, colorHex: '#00ff00', proportion: 60 },
        { position: 2, colorHex: '#FFFF00', proportion: 40 },
      ]),
    );
  });

  it('treats adjacent segments of one color as a single segment', () => {
    expect(
      cordSignature([
        { position: 1, colorHex: '#FF0000', proportion: 50 },
        { position: 2, colorHex: '#ff0000', proportion: 50 },
      ]),
    ).toBe(
      cordSignature([{ position: 1, colorHex: '#FF0000', proportion: 100 }]),
    );
  });

  it('differs when proportions differ (e.g. different-length tips)', () => {
    expect(
      cordSignature([
        { position: 1, colorHex: '#FFFFFF', proportion: 80 },
        { position: 2, colorHex: '#FFFF00', proportion: 20 },
      ]),
    ).not.toBe(
      cordSignature([
        { position: 1, colorHex: '#FFFFFF', proportion: 70 },
        { position: 2, colorHex: '#FFFF00', proportion: 30 },
      ]),
    );
  });

  it('differs when the color order is reversed', () => {
    expect(
      cordSignature([
        { position: 1, colorHex: '#00FF00', proportion: 50 },
        { position: 2, colorHex: '#FFFF00', proportion: 50 },
      ]),
    ).not.toBe(
      cordSignature([
        { position: 1, colorHex: '#FFFF00', proportion: 50 },
        { position: 2, colorHex: '#00FF00', proportion: 50 },
      ]),
    );
  });
});
